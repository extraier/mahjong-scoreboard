#!/usr/bin/env python3
"""
mahjong_local_inference.py — single-file pipeline for local mahjong tile recognition.

Pipeline:
  1. Load user's hand photo (full scene)
  2. OpenCV detect tile bounding boxes via contour analysis
  3. Crop each tile region, resize to 224x224
  4. ViT classifier assigns tile label
  5. Output list of {tile_symbol, confidence, bbox}

Usage:
  python3 mahjong_local_inference.py <image_path> [--json]
  python3 mahjong_local_inference.py <image_path> --debug   # save crop PNGs
"""

import sys
import json
import argparse
import time
import os
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import ViTImageProcessor, ViTForImageClassification

MODEL_DIR = Path(os.environ.get('LOCAL_VISION_MODEL_DIR', '/Users/roger/mahjong-scoreboard/models/mahjong-vision-krmin/vision_transformer_local'))

# Riichi notation (model output) -> our 麻雀 notation (W/T/S/F/H)
RIICHI_TO_OURS = {}
for n in range(1, 10):
    RIICHI_TO_OURS[f'{n}m'] = f'W{n}'  # 万/wan
    RIICHI_TO_OURS[f'{n}n'] = f'W{n}'  # alias used by model
    RIICHI_TO_OURS[f'{n}p'] = f'T{n}'  # 筒/tong
    RIICHI_TO_OURS[f'{n}s'] = f'S{n}'  # 索/sou
    RIICHI_TO_OURS[f'{n}b'] = f'S{n}'  # alias used by model
RIICHI_TO_OURS['ew'] = 'F1'  # East
RIICHI_TO_OURS['sw'] = 'F2'  # South
RIICHI_TO_OURS['ww'] = 'F3'  # West
RIICHI_TO_OURS['nw'] = 'F4'  # North
RIICHI_TO_OURS['wd'] = 'F7'  # White (haku)
RIICHI_TO_OURS['gd'] = 'F5'  # Green (hatsu)
RIICHI_TO_OURS['rd'] = 'F6'  # Red (chun)


class TileRecognizer:
    def __init__(self, device='mps'):
        self.processor = ViTImageProcessor.from_pretrained(MODEL_DIR)
        self.model = ViTForImageClassification.from_pretrained(MODEL_DIR)
        self.device = device if torch.backends.mps.is_available() and device == 'mps' else 'cpu'
        self.model = self.model.to(self.device)
        self.model.eval()
        self.id2ours = {}
        for idx_str, riichi_label in self.model.config.id2label.items():
            self.id2ours[int(idx_str)] = RIICHI_TO_OURS.get(riichi_label)
        print(f'[recognizer] model loaded on {self.device}, 34 classes, id2ours={len(self.id2ours)}')

    def classify_crop(self, crop_pil, logit_bias=None):
        """Run ViT on a single crop. Returns (our_label, confidence).

        logit_bias: optional tensor of shape [num_classes] added to logits
            before argmax. Used to compensate for class imbalance bias.
        """
        inputs = self.processor(images=crop_pil, return_tensors='pt').to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        logits = outputs.logits[0]  # shape [num_classes]
        if logit_bias is not None:
            logits = logits + logit_bias.to(logits.device)
        probs = torch.nn.functional.softmax(logits, dim=0)
        top_id = int(probs.argmax())
        conf = float(probs[top_id])
        return self.id2ours[top_id], conf


def detect_tile_boxes(image_bgr, min_area=300, max_area_ratio=0.6, min_side=32, debug=False):
    """Detect tile rectangles in a scene photo using OpenCV.

    Strategy:
      1. Convert to grayscale, blur
      2. Canny edges + dilate
      3. Find contours (RETR_TREE so adjacent tiles stay separate)
      4. Filter by area + minimum side length
      5. De-dup overlapping boxes (NMS-lite)
      6. Split any bbox wider than 70px (probably 2-3 tiles in row)
    Returns list of (x, y, w, h).
    """
    h, w = image_bgr.shape[:2]
    img_area = h * w
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    raw_boxes = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area or area > img_area * max_area_ratio:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        if bw < min_side or bh < min_side:
            continue
        aspect = bw / float(bh) if bh else 0
        if not (0.4 < aspect < 2.5):
            continue
        raw_boxes.append((x, y, bw, bh))

    # NMS-lite
    raw_boxes.sort(key=lambda b: -b[2] * b[3])
    kept = []
    for b in raw_boxes:
        bx, by, bw, bh = b
        is_dup = False
        for kx, ky, kw, kh in kept:
            ix1 = max(bx, kx); iy1 = max(by, ky)
            ix2 = min(bx + bw, kx + kw); iy2 = min(by + bh, ky + kh)
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                smaller_area = min(bw * bh, kw * kh)
                if inter / smaller_area > 0.5:
                    is_dup = True
                    break
        if not is_dup:
            kept.append(b)

    # Split wide bboxes (when RETR_TREE merged several tiles into one)
    split_boxes = []
    for (x, y, bw, bh) in kept:
        if bw > 50 and bw > bh * 0.95:
            # Estimate single-tile width from the height
            est_tile_w = max(30, int(bh * 0.85))
            n_tiles = max(2, round(bw / est_tile_w))
            actual_tile_w = bw // n_tiles
            for i in range(n_tiles):
                tx = x + i * actual_tile_w
                split_boxes.append((tx, y, actual_tile_w, bh))
        else:
            split_boxes.append((x, y, bw, bh))

    row_height = max(50, h // 6)
    return sorted(split_boxes, key=lambda b: (b[1] // row_height, b[0]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()

    img_path = Path(args.image)
    if not img_path.exists():
        print(f'file not found: {img_path}', file=sys.stderr)
        sys.exit(2)

    image_bgr = cv2.imread(str(img_path))
    if image_bgr is None:
        print(f'cv2 failed to load: {img_path}', file=sys.stderr)
        sys.exit(2)
    print(f'[input] {img_path} shape={image_bgr.shape}')

    recognizer = TileRecognizer()

    t0 = time.time()
    boxes = detect_tile_boxes(image_bgr)
    t_det = time.time() - t0
    print(f'[detect] found {len(boxes)} candidate tile boxes in {t_det*1000:.0f}ms')

    if args.debug:
        debug_dir = Path('/tmp/mahjong-crops')
        debug_dir.mkdir(parents=True, exist_ok=True)
        for i, (x, y, bw, bh) in enumerate(boxes):
            cv2.imwrite(str(debug_dir / f'crop_{i:02d}.png'), image_bgr[y:y+bh, x:x+bw])

    tiles = []
    confidences = []
    t0 = time.time()
    for i, (x, y, bw, bh) in enumerate(boxes):
        crop_bgr = image_bgr[y:y+bh, x:x+bw]
        crop_pil = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)).resize((224, 224))
        label, conf = recognizer.classify_crop(crop_pil)
        # Filter out non-tile predictions (low confidence = likely text/symbol/partial)
        if conf < 0.4:
            print(f'[tile {i:02d}] bbox=({x},{y},{bw}x{bh}) -> REJECTED conf={conf:.3f} (low conf)')
            continue
        tiles.append(label)
        confidences.append(conf)
        print(f'[tile {i:02d}] bbox=({x},{y},{bw}x{bh}) -> {label} conf={conf:.3f}')
    t_cls = time.time() - t0
    print(f'[classify] {len(boxes)} tiles in {t_cls*1000:.0f}ms ({t_cls/len(boxes)*1000:.0f}ms/tile)')

    avg_conf = float(np.mean(confidences)) if confidences else 0.0
    output = {
        'image': str(img_path),
        'tile_count': len(tiles),
        'tiles': tiles,
        'avg_confidence': avg_conf,
        'confidences': confidences,
        'boxes': [list(b) for b in boxes],
        'elapsed_detect_ms': int(t_det * 1000),
        'elapsed_classify_ms': int(t_cls * 1000),
    }
    if args.json:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(f'\n[result] {len(tiles)} tiles: {tiles}')
        print(f'[result] avg confidence: {avg_conf:.3f}')


if __name__ == '__main__':
    main()
