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
  - 'hybrid': YOLO + OpenCV combined via NMS, v4 ViT classifies.
  - 'ensemble': Hybrid detector + ensemble v4 ViT + YOLO label (best of both).
"""

# Riichi → HK mapping for YOLO label translation
_RIICHI_TO_HK = {
    '1m': 'W1', '2m': 'W2', '3m': 'W3', '4m': 'W4', '5m': 'W5',
    '6m': 'W6', '7m': 'W7', '8m': 'W8', '9m': 'W9',
    '1p': 'T1', '2p': 'T2', '3p': 'T3', '4p': 'T4', '5p': 'T5',
    '6p': 'T6', '7p': 'T7', '8p': 'T8', '9p': 'T9',
    '1s': 'S1', '2s': 'S2', '3s': 'S3', '4s': 'S4', '5s': 'S5',
    '6s': 'S6', '7s': 'S7', '8s': 'S8', '9s': 'S9',
    '1z': 'F1', '2z': 'F2', '3z': 'F3', '4z': 'F4',
    '5z': 'F7', '6z': 'F6', '7z': 'F5',
    '0m': 'W5', '0p': 'T5', '0s': 'S5',
}


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

    The YOLO model is trained on Japanese riichi tile photos but we use it
    for *detection* primarily; the v4 ViT handles classification. For the
    'ensemble' mode, YOLO labels are also used.
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


def _yolo_labels_for_boxes(image_bgr, target_boxes, iou_thresh=0.3):
    """For each target box, find the matching YOLO detection (by best IoU)
    and return (hk_label, yolo_conf) or (None, 0.0) if no match >= threshold.
    Used by ensemble mode.
    """
    model = _load_yolo()
    img_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    # Lower conf threshold so we catch candidates even when v4 is the primary
    results = model(img_rgb, conf=0.10, verbose=False, device='mps')[0]
    out = []
    for tx, ty, tw, th in target_boxes:
        best_iou = 0
        best_label = (None, 0.0)
        for box in results.boxes:
            yx1, yy1, yx2, yy2 = box.xyxy[0].tolist()
            yw, yh = yx2 - yx1, yy2 - yy1
            iou = _box_iou((int(tx), int(ty), int(tw), int(th)),
                          (int(yx1), int(yy1), int(yw), int(yh)))
            if iou > best_iou:
                best_iou = iou
                cls_id = int(box.cls[0])
                cls_name = model.names[cls_id]
                hk_name = _RIICHI_TO_HK.get(cls_name, None)
                best_label = (hk_name, float(box.conf[0]))
        out.append(best_label if best_iou >= iou_thresh else (None, 0.0))
    return out


def _box_iou(a, b):
    """Compute IoU between two boxes (x, y, w, h)."""
    ax1, ay1, aw, ah = a
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx1, by1, bw, bh = b
    bx2, by2 = bx1 + bw, by1 + bh
    # Intersection
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _nms_combine(primary, secondary, iou_thresh=0.5):
    """Combine two box lists. Keep all primary boxes; add secondary boxes
    that don't overlap with any primary box above iou_thresh.
    """
    out = list(primary)
    for s in secondary:
        if all(_box_iou(s, p) < iou_thresh for p in out):
            out.append(s)
    return out


def _dedup_boxes(boxes, iou_thresh=0.5):
    """Remove near-duplicate boxes. Keeps the first occurrence of each
    cluster of overlapping boxes. Used after combining YOLO+OpenCV where
    each detector can independently emit the same tile (e.g. duplicate
    YOLO detections on image 8 returned T7+T6 for the same tile).
    """
    out = []
    for b in boxes:
        if all(_box_iou(b, p) < iou_thresh for p in out):
            out.append(b)
    return out


def detect_sliding_window(image_bgr, stride_ratio=0.6):
    """Sliding-window tile detector. Crops the image into overlapping
    windows and runs the v4 ViT classifier on each crop, keeping only
    crops with high-confidence tile predictions.

    This is the slowest but most permissive detector — used only when
    YOLO and OpenCV both fail (e.g. extremely cluttered or unusual
    layouts). For each window, we count how many of the v4 ViT's
    top-1 predictions look like real tiles (high conf), and if >= 1
    we emit a single bounding box covering the window.
    """
    h, w = image_bgr.shape[:2]
    # Window size: ~1.5x average tile size estimate
    win_w = max(40, int(w * 0.12))
    win_h = max(40, int(h * 0.18))
    stride_w = max(20, int(win_w * stride_ratio))
    stride_h = max(20, int(win_h * stride_ratio))

    boxes = []
    # Reuse the service's recognizer via a side-channel? Simpler: skip
    # the classifier here, just emit grid-aligned candidate boxes. The
    # downstream v4 ViT will reject the garbage via low conf threshold.
    for y in range(0, h - win_h + 1, stride_h):
        for x in range(0, w - win_w + 1, stride_w):
            boxes.append((x, y, win_w, win_h))
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
        detector_used = self.detector
        if self.detector == 'yolo':
            boxes = detect_tile_boxes_yolo(image_bgr, conf_thresh=0.20)
            # YOLO fallback: if too few tiles found, try OpenCV
            # (YOLO under-detects on sparse multi-row photos like image 5)
            if len(boxes) < 5:
                opencv_boxes = detect_tile_boxes(image_bgr)
                if len(opencv_boxes) > len(boxes):
                    boxes = opencv_boxes
                    detector_used = 'yolo+opencv-fallback'
            boxes = _dedup_boxes(boxes)
        elif self.detector == 'hybrid':
            # Always run YOLO first, supplement with OpenCV for missed tiles
            yolo_boxes = detect_tile_boxes_yolo(image_bgr, conf_thresh=0.20)
            opencv_boxes = detect_tile_boxes(image_bgr)
            # NMS: prefer YOLO boxes (more accurate bboxes), add OpenCV
            # boxes that don't overlap with any YOLO box.
            boxes = _nms_combine(yolo_boxes, opencv_boxes, iou_thresh=0.5)
            boxes = _dedup_boxes(boxes)
            detector_used = 'hybrid'
        elif self.detector == 'sliding':
            # Sliding-window fallback: try YOLO + OpenCV + sliding crop
            yolo_boxes = detect_tile_boxes_yolo(image_bgr, conf_thresh=0.20)
            opencv_boxes = detect_tile_boxes(image_bgr)
            boxes = _nms_combine(yolo_boxes, opencv_boxes, iou_thresh=0.5)
            if len(boxes) < 5:
                sw_boxes = detect_sliding_window(image_bgr)
                boxes = _nms_combine(boxes, sw_boxes, iou_thresh=0.3)
                detector_used = 'sliding'
            else:
                detector_used = 'hybrid'
            boxes = _dedup_boxes(boxes)
        elif self.detector == 'ensemble':
            # Hybrid detector + ensemble classification (v4 ViT + YOLO label)
            yolo_boxes = detect_tile_boxes_yolo(image_bgr, conf_thresh=0.20)
            opencv_boxes = detect_tile_boxes(image_bgr)
            boxes = _nms_combine(yolo_boxes, opencv_boxes, iou_thresh=0.5)
            boxes = _dedup_boxes(boxes)
            detector_used = 'ensemble'
        else:
            boxes = detect_tile_boxes(image_bgr)
        detect_ms = int((time.time() - t_det0) * 1000)

        # For ensemble mode, get YOLO labels for each box once (avoids
        # running YOLO inference N times).
        yolo_labels_per_box = None
        if self.detector == 'ensemble':
            yolo_labels_per_box = _yolo_labels_for_boxes(image_bgr, boxes)

        tiles = []
        confidences = []
        rejected = []
        ensemble_log = []
        t_cls0 = time.time()
        for i, (x, y, bw, bh) in enumerate(boxes):
            crop_bgr = image_bgr[y:y+bh, x:x+bw]
            crop_pil = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)).resize((224, 224))
            label, conf = self.recognizer.classify_crop(crop_pil)
            chosen_label = label
            chosen_conf = conf
            if self.detector == 'ensemble' and yolo_labels_per_box is not None:
                yolo_label, yolo_conf = yolo_labels_per_box[i]
                if yolo_label and yolo_conf > chosen_conf:
                    chosen_label = yolo_label
                    chosen_conf = yolo_conf
                    ensemble_log.append({'i': i, 'v4': label, 'v4_conf': round(conf, 4),
                                         'yolo': yolo_label, 'yolo_conf': round(yolo_conf, 4),
                                         'chose': 'yolo'})
            if chosen_conf < self.min_conf or chosen_label is None:
                rejected.append({'index': i, 'bbox': [x, y, bw, bh], 'conf': round(chosen_conf, 4)})
                continue
            tiles.append(chosen_label)
            confidences.append(round(chosen_conf, 4))
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
            'detector_used': detector_used,
            'ensemble_swaps': ensemble_log if ensemble_log else None,
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
