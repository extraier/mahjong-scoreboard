#!/usr/bin/env python3
"""Convert mahjong-real-data (628 single-tile real photos) to our namespace.

Source: models/mahjong-real-data/images/<id>.jpg + data.csv with labels
Format: each image is ALREADY a single tile (240x320), no extraction needed
Labels: bamboo-N (N=1-9), characters-N (N=1-9), dots-N (N=1-9),
        honors-X (east/south/west/north/green/red/white),
        bonus-X (spring/summer/autumn/winter, plum/orchid/chrysanthemum/bamboo)

Output: data/real-tiles-v7-mahjongreal/<class>/*.jpg
  - For our 34 canonical classes: 1b-9b (characters), 1n-9n (bamboo),
    1p-9p (dots), ew/sw/ww/nw (winds), gd/rd/wd (dragons)
  - Bonus classes are excluded (not in our model's 34 classes)
"""

import os
import shutil
import csv
from pathlib import Path
from collections import Counter, defaultdict

SOURCE_DIR = Path('/Users/roger/mahjong-scoreboard/models/mahjong-real-data')
OUTPUT_DIR = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v7-mahjongreal')

# Map source labels to our model namespace
LABEL_MAP = {
    # characters -> 1b-9b (萬 = W in HK)
    'characters-1': '1b', 'characters-2': '2b', 'characters-3': '3b',
    'characters-4': '4b', 'characters-5': '5b', 'characters-6': '6b',
    'characters-7': '7b', 'characters-8': '8b', 'characters-9': '9b',
    # bamboo -> 1n-9n (索 = bamboo)
    'bamboo-1': '1n', 'bamboo-2': '2n', 'bamboo-3': '3n',
    'bamboo-4': '4n', 'bamboo-5': '5n', 'bamboo-6': '6n',
    'bamboo-7': '7n', 'bamboo-8': '8n', 'bamboo-9': '9n',
    # dots -> 1p-9p (筒 = dots)
    'dots-1': '1p', 'dots-2': '2p', 'dots-3': '3p',
    'dots-4': '4p', 'dots-5': '5p', 'dots-6': '6p',
    'dots-7': '7p', 'dots-8': '8p', 'dots-9': '9p',
    # honors -> wind/dragon
    'honors-east': 'ew',   # 東
    'honors-south': 'sw',  # 南
    'honors-west': 'ww',   # 西
    'honors-north': 'nw',  # 北
    'honors-green': 'gd',  # 發 (green dragon)
    'honors-red': 'rd',    # 中 (red dragon)
    'honors-white': 'wd',  # 白 (white dragon)
    # bonus (flowers/seasons) — NOT in our 34 classes, excluded
}


def main():
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    csv_path = SOURCE_DIR / 'data.csv'
    images_dir = SOURCE_DIR / 'images'

    if not csv_path.exists():
        print(f'CSV not found: {csv_path}')
        return

    # Read CSV: image-name,label,label-name
    counts = Counter()
    skipped = 0
    total = 0
    excluded_bonus = 0

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            label_name = row['label-name']
            img_name = row['image-name']

            if label_name not in LABEL_MAP:
                excluded_bonus += 1
                continue

            our_label = LABEL_MAP[label_name]
            src = images_dir / img_name
            if not src.exists():
                skipped += 1
                continue

            dst_dir = OUTPUT_DIR / our_label
            dst_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst_dir / img_name)
            counts[our_label] += 1

    print(f'CSV total rows: {total}')
    print(f'Excluded bonus classes: {excluded_bonus}')
    print(f'Skipped (missing image): {skipped}')
    print(f'\nExtracted {sum(counts.values())} images across {len(counts)} classes:\n')
    for cls in sorted(counts.keys()):
        print(f'  {cls}: {counts[cls]}')

    print(f'\nOutput: {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
