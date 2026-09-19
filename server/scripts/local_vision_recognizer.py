#!/usr/bin/env python3
"""
local_vision_recognizer.py — long-lived TileRecognizer for the FastAPI server.

Imports TileRecognizer from mahjong_local_inference and exposes it as a
module-singleton. Model is loaded **once** at server start; subsequent
.classify_hand(image_bgr) calls reuse the in-memory model.
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

# Allow `from mahjong_local_inference import TileRecognizer` to work
# when this file is in scripts/ alongside the original.
sys.path.insert(0, str(Path(__file__).parent))
from mahjong_local_inference import (  # noqa: E402
    TileRecognizer,
    detect_tile_boxes,
)


class LocalVisionService:
    """Singleton wrapper around TileRecognizer with hand-photo pipeline.

    One instance per FastAPI worker. Model + processor + on MPS device
    allocated once at startup, reused across requests.
    """

    def __init__(self, device='mps', min_conf=0.0):
        self.device = device if torch.backends.mps.is_available() else 'cpu'
        # Python side has NO filter — return every detection with its conf.
        # The Node layer applies the adaptive threshold via
        # tileFilter.filterByConfidence(). This lets very-low-res photos
        # recover tiles that would otherwise be silently dropped (the
        # classifier tops out at ~0.23 conf on truly tiny images).
        self.min_conf = min_conf
        print(f'[local_vision] loading TileRecognizer on {self.device}...', flush=True)
        t0 = time.time()
        self.recognizer = TileRecognizer(device=self.device)
        print(f'[local_vision] model loaded in {(time.time()-t0)*1000:.0f}ms', flush=True)

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
        }


_singleton: LocalVisionService | None = None


def get_service() -> LocalVisionService:
    global _singleton
    if _singleton is None:
        _singleton = LocalVisionService()
    return _singleton
