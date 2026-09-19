#!/usr/bin/env python3
"""
local_vision_recognizer.py — long-lived TileRecognizer for the FastAPI server.

Imports TileRecognizer from mahjong_local_inference and exposes it as a
module-singleton. Model is loaded **once** at server start; subsequent
.classify_hand(image_bgr) calls reuse the in-memory model.

Detector options (selected by LOCAL_VISION_DETECTOR env var):
  - 'opencv' (default): contour-based, fast, fails on touching tiles
  - 'yolo': YOLOv11n from nikmomo/Mahjong-YOLO — handles touching tiles
           but classes are riichi notation (1m-9m, 1p-9p, 1s-9s, 1z-7z)
           so we use YOLO boxes for detection only and the v4 ViT for
           classification. Tile classification happens via the ViT crops.
"""

import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

# Allow `from mahjong_local_inference import TileRecognizer` work
# when this file is in scripts/ alongside the original.
sys.path.insert(0, str(Path(__file__).parent))
from mahjong_local_inference import (  # noqa: E402
    TileRecognizer,
    detect_tile_boxes,
)

# YOLO detector (optional — only loaded if selected)
_YOLO_MODEL = None
_YOLO_PATH = os.environ.get(
    'LOCAL_VISION_YOLO_PATH',
    '/Users/roger/mahjong-scoreboard/server/models/mahjong-yolo/yolo11n_best.pt',
)


def _load_yolo():
    global _YOLO_MODEL
    if _YOLO_MODEL is None:
        try:
            from ultralytics import YOLO as UltralyticsYOLO
        except ImportError:
            print('[local_vision] ERROR: ultralytics not installed — `pip install ultralytics`', flush=True)
            raise
        print(f'[local_vision] loading YOLO detector from {_YOLO_PATH}...', flush=True)
        t0 = time.time()
        _YOLO_MODEL = UltralyticsYOLO(_YOLO_PATH)
        print(f'[local_vision] YOLO loaded in {(time.time()-t0)*1000:.0f}ms', flush=True)
    return _YOLO_MODEL


def detect_tile_boxes_yolo(image_bgr, conf_thresh=0.25):
    """Detect tile bounding boxes using YOLOv11. Returns list of (x, y, w, h).

    The YOLO model is trained on Japanese riichi tile photos but we only
    use it for *detection* — the classifier (ViT v4) handles actual tile
    identity. So the class predictions here are discarded.
    """
    model = _load_yolo()
    # ultralytics expects RGB
    img_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    results = model(img_rgb, conf=conf_thresh, verbose=False, device='mps')
    r = results[0]
    boxes = []
    for box in r.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        w = x2 - x1
        h = y2 - y1
        boxes.append((int(x1), int(y1), int(w), int(h)))
    return boxes


class LocalVisionService:
    """Singleton wrapper around TileRecognizer with hand-photo pipeline.

    One instance per FastAPI worker. Model + processor + on MPS device
    allocated once at startup, reused across requests.
    """

    def __init__(self, device='mps', min_conf=0.0, detector=None):
        self.device = device if torch.backends.mps.is_available() else 'cpu'
        # Python side has NO filter — return every detection with its conf.
        # The Node layer applies the adaptive threshold via
        # tileFilter.filterByConfidence(). This lets very-low-res photos
        # recover tiles that would otherwise be silently dropped (the
        # classifier tops out at ~0.23 conf on truly tiny images).
        self.min_conf = min_conf
        # Detector selection: 'opencv' (default, fast) or 'yolo' (handles
        # touching tiles but slower + needs ultralytics installed).
        # Override via LOCAL_VISION_DETECTOR env var or constructor arg.
        self.detector = detector or os.environ.get('LOCAL_VISION_DETECTOR', 'opencv')
        if self.detector == 'yolo':
            _load_yolo()  # eager-load so /health shows YOLO status
        print(f'[local_vision] loading TileRecognizer on {self.device}...', flush=True)
        t0 = time.time()
        self.recognizer = TileRecognizer(device=self.device)
        print(f'[local_vision] model loaded in {(time.time()-t0)*1000:.0f}ms, detector={self.detector}', flush=True)

    def classify_hand(self, image_bgr) -> dict:
        """Run full pipeline: detect tiles -> classify each -> return JSON-able dict.

        Returns image width/height so the caller can apply adaptive confidence
        thresholds for low-resolution photos.

        Pre-upscales tiny images (height < 100 or width < 400) so the
        detector (OpenCV findContours) can find tile boundaries. The
        classifier still operates on the upscaled crop area, scaled to
        224×224 as before.
        """
        orig_h, orig_w = image_bgr.shape[:2]
        h, w = orig_h, orig_w
        upscale_applied = False
        upscale_note = None
        if h < 100 or w < 400:
            # Bring height to >= 200px so OpenCV can find contours.
            scale = max(2, (200 + h - 1) // max(1, h))
            new_w, new_h = w * scale, h * scale
            image_bgr = cv2.resize(image_bgr, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            upscale_applied = True
            upscale_note = f'pre-upscaled {orig_w}x{orig_h} -> {new_w}x{new_h} (x{scale}) for detection'
            h, w = new_h, new_w

        t_det0 = time.time()
        if self.detector == 'yolo':
            boxes = detect_tile_boxes_yolo(image_bgr, conf_thresh=0.20)
        else:
            boxes = detect_tile_boxes(image_bgr)
        detect_ms = int((time.time() - t_det0) * 1000)

        tiles = []
        confidences = []
        rejected = []
        t_cls0 = time.time()
        for i, (x, y, bw, bh) in enumerate(boxes):
            crop_bgr = image_bgr[y:y+bh, x:x+bw]
            crop_pil = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)).resize((224, 224))
            label, conf = self.recognizer.classify_crop(crop_pil)
            if conf < self.min_conf or label is None:
                rejected.append({'index': i, 'bbox': [x, y, bw, bh], 'conf': round(conf, 4)})
                continue
            tiles.append(label)
            confidences.append(round(conf, 4))
        classify_ms = int((time.time() - t_cls0) * 1000)

        avg_conf = float(np.mean(confidences)) if confidences else 0.0
        return {
            'width': int(w),
            'height': int(h),
            'original_width': int(orig_w),
            'original_height': int(orig_h),
            'upscale_applied': upscale_applied,
            'upscale_note': upscale_note,
            'tile_count': len(tiles),
            'tiles': tiles,
            'confidences': confidences,
            'avg_confidence': round(avg_conf, 4),
            'boxes': [list(b) for b in boxes],
            'box_count': len(boxes),
            'rejected': rejected,
            'elapsed_detect_ms': detect_ms,
            'elapsed_classify_ms': classify_ms,
        }

    def health(self) -> dict:
        return {
            'status': 'ready',
            'device': self.device,
            'min_conf': self.min_conf,
            'num_classes': len(self.recognizer.id2ours),
            'detector': self.detector,
        }


_singleton: LocalVisionService | None = None


def get_service() -> LocalVisionService:
    global _singleton
    if _singleton is None:
        _singleton = LocalVisionService()
    return _singleton
