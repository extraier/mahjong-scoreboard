#!/usr/bin/env python3
"""
extract_real_tile_crops.py — from user-supplied full-hand photos, extract
individual tile crops and save them to a structured dataset for fine-tuning.

Input: image_path + ground_truth_tiles (JSON list, ordered left-to-right)
Output: tiles/<class>/<image_stem>_<idx>.png  for each tile

This produces labelled real-photo tiles in the same format as
desertraider/mahjong_souls_tiles so fine-tune pipeline works directly.
"""

import argparse
import json
import sys
from pathlib import Path
import cv2
import numpy as np


RIICHI_TO_LABEL_MAP = {
    **{f'{n}m': f'{n}n' for n in range(1, 10)},
    **{f'{n}p': f'{n}p' for n in range(1, 10)},
    **{f'{n}s': f'{n}b' for n in range(1, 10)},
    'ew': 'ew', 'sw': 'sw', 'ww': 'ww', 'nw': 'nw',
    'wd': 'wd', 'gd': 'gd', 'rd': 'rd',
}


def detect_tile_boxes(image_bgr):
    """Detect + split bboxes, returning list of (x, y, w, h)."""
    h, w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    raw = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < 300 or area > h * w * 0.6:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        if bw < 32 or bh < 32:
            continue
        aspect = bw / float(bh) if bh else 0
        if not (0.4 < aspect < 2.5):
            continue
        raw.append((x, y, bw, bh))

    raw.sort(key=lambda b: -b[2] * b[3])
    kept = []
    for b in raw:
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

    split = []
    for (x, y, bw, bh) in kept:
        if bw > 50 and bw > bh * 0.95:
            est_tile_w = max(30, int(bh * 0.85))
            n = max(2, round(bw / est_tile_w))
            actual_w = bw // n
            for i in range(n):
                split.append((x + i * actual_w, y, actual_w, bh))
        else:
            split.append((x, y, bw, bh))

    row_height = max(50, h // 6)
    return sorted(split, key=lambda b: (b[1] // row_height, b[0]))


def map_label(riichi_or_ours: str) -> str:
    """Accept either our notation (W1, T5, F1, H1) or riichi (1m, 1p, ew, etc.)."""
    s = riichi_or_ours.strip()
    # Our notation
    if len(s) == 2 and s[0] in 'WTFS' and s[1].isdigit():
        n = s[1]
        suit = s[0]
        if suit == 'W':
            return f'{n}n'
        if suit == 'T':
            return f'{n}p'
        if suit == 'S':
            return f'{n}b'
        if suit == 'F':
            # F1=東, F2=南, F3=西, F4=北, F5=發(green), F6=中(red), F7=白(white)
            honor_map = {'1': 'ew', '2': 'sw', '3': 'ww', '4': 'nw',
                         '5': 'gd', '6': 'rd', '7': 'wd'}
            return honor_map.get(n, s)
        if suit == 'H':
            return s
    return RIICHI_TO_LABEL_MAP.get(s, s)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('image')
    p.add_argument('tiles_json', help='JSON list of tile labels in order, e.g. ["W1","W1","W1","W4",...]')
    p.add_argument('--out-dir', required=True)
    args = p.parse_args()

    img_path = Path(args.image)
    with open(args.tiles_json) as f:
        gt_tiles = json.load(f)

    if not img_path.exists():
        print(f'image not found: {img_path}', file=sys.stderr)
        sys.exit(2)

    image = cv2.imread(str(img_path))
    if image is None:
        print(f'cv2 failed to load {img_path}', file=sys.stderr)
        sys.exit(2)

    boxes = detect_tile_boxes(image)
    print(f'detected {len(boxes)} boxes; ground truth has {len(gt_tiles)} tiles')

    if len(boxes) != len(gt_tiles):
        print(f'WARN: box count {len(boxes)} != ground truth {len(gt_tiles)} — will match what we can')

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    for i, (box, label) in enumerate(zip(boxes, gt_tiles)):
        x, y, bw, bh = box
        # Pad slightly for context
        pad = 2
        x0 = max(0, x - pad); y0 = max(0, y - pad)
        x1 = min(image.shape[1], x + bw + pad); y1 = min(image.shape[0], y + bh + pad)
        crop = image[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        cls_dir = out_dir / label
        cls_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(cls_dir / f'{img_path.stem}_{i:02d}.png'), crop)
        saved += 1
        print(f'  [{i:02d}] -> {label}')

    print(f'saved {saved} tile crops to {args.out_dir}')


if __name__ == '__main__':
    main()
