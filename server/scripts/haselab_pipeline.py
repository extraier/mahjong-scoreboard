#!/usr/bin/env python3
"""
haselab_pipeline.py — HaseLab 3-stage polygon+homography pipeline.

Solves the standing-tile perspective problem that YOLO+bbox fails on.

Pipeline:
  1. regions-yolo: detect hand region (bbox)
  2. tile-yolo: detect individual tiles + polygon corners
  3. Homography warp: each polygon -> 224x224 canonical square
  4. classifier-resnet50: classify normalized tile (39 riichi classes)
  5. Map riichi -> HK notation (our 34-class space)

Key insight: polygon corners + homography transforms any perspective view
of a tile into a flat-laid canonical view. The classifier never sees
perspective-distorted tiles again.

Reference: https://huggingface.co/HaseLab/mahjong-models
"""

import os
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

# Riichi -> HK mapping (matches our model namespace).
# F5 = 發 (green dragon), F6 = 中 (red dragon), F7 = 白 (white dragon).
# HaseLab class ordering: 0m, 0p, 0s, 0z, 1m, 1p, 1s, 1z, ..., 9s, back (39 total)
# 0m/0p/0s = red-5 man/pin/sou (marked with red dot, otherwise same as 5m/5p/5s)
# 0z = could be red 5 z (= 中 red dragon, F6)
# 1z..4z = 東南西北 (F1..F4)
# 5z = 白 (F7) - white dragon
# 6z = 發 (F5) - green dragon
# 7z = 中 (F6) - red dragon
RIICHI_TO_HK = {
    # Numbered tiles (red-5 + regular)
    '0m': 'W5',   # red 5 man (5m with red dot)
    '0p': 'T5',   # red 5 pin
    '0s': 'S5',   # red 5 sou
    '0z': 'F6',   # red z = red dragon (中) - best guess
    '1m': 'W1', '1p': 'T1', '1s': 'S1',
    '2m': 'W2', '2p': 'T2', '2s': 'S2',
    '3m': 'W3', '3p': 'T3', '3s': 'S3',
    '4m': 'W4', '4p': 'T4', '4s': 'S4',
    '5m': 'W5', '5p': 'T5', '5s': 'S5',
    '6m': 'W6', '6p': 'T6', '6s': 'S6',
    '7m': 'W7', '7p': 'T7', '7s': 'S7',
    '8m': 'W8', '8p': 'T8', '8s': 'S8',
    '9m': 'W9', '9p': 'T9', '9s': 'S9',
    # Winds + dragons
    '1z': 'F1',  # 東
    '2z': 'F2',  # 南
    '3z': 'F3',  # 西
    '4z': 'F4',  # 北
    '5z': 'F7',  # 白 (white dragon)
    '6z': 'F5',  # 發 (green dragon)
    '7z': 'F6',  # 中 (red dragon)
    'back': None,  # tile back - skip
}

# Reverse mapping for ResNet-50 classifier output (39 classes, ordered by HaseLab)
HASELAB_CLASSES = [
    '0m', '0p', '0s', '0z',
    '1m', '1p', '1s', '1z',
    '2m', '2p', '2s', '2z',
    '3m', '3p', '3s', '3z',
    '4m', '4p', '4s', '4z',
    '5m', '5p', '5s', '5z',
    '6m', '6p', '6s', '6z',
    '7m', '7p', '7s', '7z',
    '8m', '8p', '8s',
    '9m', '9p', '9s',
    'back',
]


def order_corners(pts):
    """Order 4 points as TL, TR, BR, BL."""
    pts = np.array(pts, dtype=np.float32)
    if len(pts) < 4:
        return None
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def warp_tile(img, polygon, out_size=224):
    """Warp a quadrilateral polygon to a square canonical view.

    Args:
        img: BGR image (numpy array)
        polygon: list of (x,y) points defining the tile quadrilateral
        out_size: output square size (default 224)

    Returns:
        warped BGR image (out_size, out_size, 3) or None if polygon is invalid
    """
    if len(polygon) < 4:
        return None
    poly_arr = np.array(polygon, dtype=np.float32)
    # Use convex hull to handle multi-point polygons
    hull = cv2.convexHull(poly_arr)
    if len(hull) < 4:
        return None
    hull = hull.reshape(-1, 2)

    # If hull has >4 points, use minAreaRect to get the dominant quad
    if len(hull) > 4:
        rect = cv2.minAreaRect(hull)
        box = cv2.boxPoints(rect)
        corners = order_corners(box)
    else:
        corners = order_corners(hull)
    if corners is None:
        return None

    dst = np.array([[0, 0], [out_size, 0], [out_size, out_size], [0, out_size]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, M, (out_size, out_size))
    return warped


class HaseLabPipeline:
    """3-stage polygon+homography pipeline.

    Use as detector in LocalVisionService by setting LOCAL_VISION_DETECTOR=haselab.
    Falls back to hybrid if HaseLab models fail or find too few tiles.
    """

    def __init__(self, device='mps', use_external_classifier=True):
        """Args:
            use_external_classifier: If True, defer classification to caller
                (which should use the v5 ViT classifier via classify_hand).
                The HaseLab pipeline then only does detection+warping.
                Set to False to use the built-in ResNet-50 (98% acc on riichi
                game screenshots, but weaker on real photos).
        """
        from ultralytics import YOLO
        import torchvision.models as models
        import torchvision.transforms as T

        self.device = device
        self.use_external_classifier = use_external_classifier
        self.regions_yolo = None
        self.tile_yolo = None
        self.resnet = None
        self.transforms = None
        self.classifier_loaded = False
        self.class_names = None

        model_dir = '/Users/roger/mahjong-scoreboard/server/models/haselab-mahjong'
        try:
            self.regions_yolo = YOLO(f'{model_dir}/regions-yolo-26n.pt')
            # Use fine-tuned tile-yolo for standing-tile photos (1-image fine-tune
            # on user's image 9, mAP50=0.759). Falls back to base model if fine-tuned
            # version not found.
            tile_yolo_path = f'{model_dir}/tile-yolo-26n.pt'
            ft_path = '/Users/roger/mahjong-scoreboard/server/models/haselab-mahjong-finetuned/tile-yolo-26n-standing.pt'
            import os as _os
            if _os.path.exists(ft_path):
                tile_yolo_path = ft_path
                print(f'[haselab] using fine-tuned tile-yolo: {ft_path}', flush=True)
            self.tile_yolo = YOLO(tile_yolo_path)
            print('[haselab] YOLO models loaded', flush=True)
        except Exception as e:
            print(f'[haselab] failed to load YOLO: {e}', flush=True)
            return

        try:
            # Load ResNet-50 classifier. The state_dict uses torchvision naming
            # (conv1, bn1, layer1..4, fc) so torchvision ResNet-50 works.
            ckpt = torch.load(f'{model_dir}/classifier-resnet50.pt',
                              map_location='cpu', weights_only=False)
            self.class_names = ckpt.get('classes', HASELAB_CLASSES)
            # The model weights are nested under 'model' key
            if 'model' in ckpt and isinstance(ckpt['model'], dict):
                state_dict = ckpt['model']
            else:
                state_dict = ckpt

            self.resnet = models.resnet50(weights=None)
            # Final fc needs to match 39 classes
            self.resnet.fc = torch.nn.Linear(self.resnet.fc.in_features, 39)
            missing, unexpected = self.resnet.load_state_dict(state_dict, strict=False)
            if missing:
                print(f'[haselab] missing keys: {len(missing)}', flush=True)
            if unexpected:
                print(f'[haselab] unexpected keys: {len(unexpected)}', flush=True)
            self.resnet.eval()
            self.resnet.to(self.device)
            print(f'[haselab] classifier loaded ({len(self.class_names)} classes) '
                  f'val_acc={ckpt.get("val_accuracy", 0):.4f}', flush=True)
            self.classifier_loaded = True
        except Exception as e:
            print(f'[haselab] failed to load classifier: {e}', flush=True)
            return

        # Preprocessing transforms for ResNet-50
        self.transforms = T.Compose([
            T.ToPILImage(),
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def detect_regions(self, image_bgr, conf=0.15):
        """Detect hand region. Returns (x, y, w, h) or None."""
        if self.regions_yolo is None:
            return None
        results = self.regions_yolo(image_bgr, conf=conf, verbose=False, device=self.device)[0]
        # Find self_hand class (class 0)
        for box in results.boxes:
            cls = int(box.cls[0])
            conf_v = float(box.conf[0])
            if cls == 0 and conf_v > 0.15:  # self_hand
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                return (int(x1), int(y1), int(x2-x1), int(y2-y1))
        return None

    def detect_tile_polygons(self, image_bgr, conf=0.10):
        """Detect individual tiles + return polygons. Returns list of dicts:
        {'polygon': [(x,y), ...], 'conf': float, 'bbox': (x, y, w, h)}
        """
        if self.tile_yolo is None:
            return []
        results = self.tile_yolo(image_bgr, conf=conf, verbose=False, device=self.device)[0]
        tiles = []
        for box, mask in zip(results.boxes, results.masks or []):
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            poly = mask.xy[0].tolist()  # polygon outline
            tiles.append({
                'polygon': poly,
                'conf': float(box.conf[0]),
                'bbox': (int(x1), int(y1), int(x2-x1), int(y2-y1)),
            })
        return tiles

    def classify_tile(self, tile_bgr):
        """Classify a normalized 224x224 BGR tile. Returns (hk_label, conf)."""
        if not self.classifier_loaded or self.resnet is None:
            return (None, 0.0)
        try:
            rgb = cv2.cvtColor(tile_bgr, cv2.COLOR_BGR2RGB)
            t = self.transforms(rgb).unsqueeze(0).to(self.device)
            with torch.no_grad():
                logits = self.resnet(t)
            probs = torch.nn.functional.softmax(logits, dim=-1)[0]
            idx = int(probs.argmax())
            conf = float(probs[idx])
            riichi_label = HASELAB_CLASSES[idx] if idx < len(HASELAB_CLASSES) else None
            hk_label = RIICHI_TO_HK.get(riichi_label)
            return (hk_label, conf)
        except Exception as e:
            return (None, 0.0)

    def detect(self, image_bgr):
        """Run pipeline detection + warp. Returns list of dicts:
          {'bbox': (x,y,w,h), 'warped': <224x224 BGR>, 'crop_bbox': (x,y,w,h) in image coords}

        The caller (LocalVisionService) classifies each warped tile with v5 ViT.
        Skipping HaseLab's built-in ResNet because it's trained on riichi game
        screenshots (98% on those) but weaker on real photos than our v5 ViT.
        """
        # Step 1: find hand region
        region = self.detect_regions(image_bgr)
        if region is not None:
            rx, ry, rw, rh = region
            pad = 10
            rx2 = min(rx + rw + pad, image_bgr.shape[1])
            ry2 = min(ry + rh + pad, image_bgr.shape[0])
            rx = max(0, rx - pad)
            ry = max(0, ry - pad)
            crop = image_bgr[ry:ry2, rx:rx2]
        else:
            crop = image_bgr
            rx, ry = 0, 0

        # Step 2: detect tile polygons
        tiles = self.detect_tile_polygons(crop)
        if len(tiles) < 5:
            tiles = self.detect_tile_polygons(crop, conf=0.05)

        results = []
        for t in tiles:
            warped = warp_tile(crop, t['polygon'])
            if warped is None:
                continue
            bx, by, bw, bh = t['bbox']
            results.append({
                'bbox': (rx + bx, ry + by, bw, bh),  # in image coords
                'warped': warped,  # already perspective-corrected 224x224
            })
        return results


# Test
if __name__ == '__main__':
    pipe = HaseLabPipeline(device='mps')

    test_images = [
        ('img 9 standing', '/Users/roger/.hermes/cache/images/img_79784bb1e376.jpg'),
        ('img 6 flat',     '/Users/roger/.hermes/cache/images/img_2defbceb9a12.jpg'),
        ('img 8 flat',     '/Users/roger/.hermes/cache/images/img_28bd52d4d3d9.jpg'),
    ]

    for label, path in test_images:
        img = cv2.imread(path)
        if img is None:
            print(f'{label}: failed to load {path}')
            continue
        print(f'\n=== {label} {img.shape} ===')
        results = pipe.detect(img)
        print(f'detected {len(results)} tiles:')
        for x, y, w, h, tile, conf in sorted(results, key=lambda b: b[0]):
            print(f'  ({x:3d}, {y:3d}, {w:3d}, {h:3d}) -> {tile} ({conf:.3f})')
