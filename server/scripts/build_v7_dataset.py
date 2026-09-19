#!/usr/bin/env python3
"""Build v7 training dataset with weighted mix.

Goal: Maximize signal from real photos without letting MJOD game screenshots
overwhelm the gradient.

Strategy: weighted random sampling to ensure each "source" contributes roughly
equally regardless of raw size.

Sources (with target weight):
  - Camerash (540 close-up tile photos)         weight 1.0
  - mahjong-real-data (541 real tile photos)    weight 1.5  # NEW, more diverse
  - Standing tiles (70, oversampled 3x = 210)   weight 1.0
  - MJOD-2136 (11181 game screenshots)          weight 0.3  # down-weighted

Target total: ~15000 train, ~3500 test
  Camerash ~ 540 (1.0)
  mahjong-real ~ 540 (1.0)  -- 541 available, oversample to match
  Standing ~ 210 (1.0)
  MJOD ~ 9000 (0.3) -- sample 9000 of 11000

Actually simpler: just use ALL sources but cap MJOD at a reasonable fraction.
"""

import os
import shutil
import random
from pathlib import Path
from collections import Counter

random.seed(42)

CAMERASH = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-2026-09-20')
STANDING = Path('/Users/roger/mahjong-scoreboard/server/data/standing-tiles-2026-09-19')
MAHJONGREAL = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v7-mahjongreal')
MJOD_TRAIN = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v6/train')
MJOD_TEST = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v6/test')
V7_DIR = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v7-combined')

# Cap MJOD to this fraction of total (avoid overwhelming)
MJOD_CAP = 0.5  # MJOD = 50% of total at most

# Oversample weights
WEIGHTS = {
    'camerash': 1.0,
    'mahjongreal': 1.0,   # NEW
    'standing': 3.0,      # 3x like before
    'mjod': 0.5,          # subsample to 50%
}


def collect_sources():
    sources = []

    # Camerash (use existing train/test split)
    for split in ['train', 'test']:
        for cls_dir in (CAMERASH / split).iterdir():
            if not cls_dir.is_dir():
                continue
            cls = cls_dir.name
            for img in cls_dir.iterdir():
                if img.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                    sources.append((cls, img, split, 'camerash'))

    # Mahjong-real (NEW; put 85% in train, 15% in test)
    for cls_dir in MAHJONGREAL.iterdir():
        if not cls_dir.is_dir():
            continue
        cls = cls_dir.name
        files = [f for f in cls_dir.iterdir() if f.suffix.lower() in ('.jpg', '.jpeg', '.png')]
        random.shuffle(files)
        n_train = int(len(files) * 0.85)
        for i, f in enumerate(files):
            split = 'train' if i < n_train else 'test'
            sources.append((cls, f, split, 'mahjongreal'))

    # Standing tiles (already split, oversample 3x)
    for split in ['train', 'test']:
        for img in (STANDING / split).iterdir():
            if img.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
                continue
            cls = img.stem.split('_')[0]
            sources.append((cls, img, split, 'standing'))

    # MJOD (train -> train, test -> test, but subsample to cap)
    mjod_train_files = []
    for cls_dir in MJOD_TRAIN.iterdir():
        if not cls_dir.is_dir():
            continue
        cls = cls_dir.name
        for f in cls_dir.iterdir():
            if f.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                mjod_train_files.append((cls, f, 'train', 'mjod'))

    mjod_test_files = []
    for cls_dir in MJOD_TEST.iterdir():
        if not cls_dir.is_dir():
            continue
        cls = cls_dir.name
        for f in cls_dir.iterdir():
            if f.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                mjod_test_files.append((cls, f, 'test', 'mjod'))

    return sources, mjod_train_files, mjod_test_files


def main():
    if V7_DIR.exists():
        shutil.rmtree(V7_DIR)
    (V7_DIR / 'train').mkdir(parents=True)
    (V7_DIR / 'test').mkdir(parents=True)

    sources, mjod_train_files, mjod_test_files = collect_sources()

    # Counts before MJOD cap
    pre_counts = Counter()
    for cls, img, split, src in sources:
        pre_counts[src] += 1
    print(f'Source counts (raw):')
    for k, v in pre_counts.items():
        print(f'  {k}: {v}')

    # Apply MJOD cap (50% of total)
    non_mjod_count = sum(c for k, c in pre_counts.items() if k != 'mjod')
    mjod_target = int(non_mjod_count * 0.5)
    print(f'\nNon-MJOD count: {non_mjod_count}')
    print(f'MJOD target (50% of non-MJOD): {mjod_target}')

    # Subsample MJOD train and test proportionally
    mjod_train_target = int(mjod_target * (len(mjod_train_files) /
                                            (len(mjod_train_files) + len(mjod_test_files))))
    mjod_test_target = mjod_target - mjod_train_target

    random.shuffle(mjod_train_files)
    random.shuffle(mjod_test_files)

    sources.extend(mjod_train_files[:mjod_train_target])
    sources.extend(mjod_test_files[:mjod_test_target])

    # Distribute to train/test based on source split
    train_counts = Counter()
    test_counts = Counter()
    src_counts = Counter()

    for cls, img, split, src in sources:
        out_dir = V7_DIR / split / cls
        out_dir.mkdir(parents=True, exist_ok=True)
        if src == 'standing':
            # Oversample 3x with different filenames
            for i in range(3):
                shutil.copy2(img, out_dir / f'{img.stem}_dup{i}{img.suffix}')
                if split == 'train':
                    train_counts[cls] += 1
                else:
                    test_counts[cls] += 1
                src_counts[src] += 1
        else:
            shutil.copy2(img, out_dir / img.name)
            if split == 'train':
                train_counts[cls] += 1
            else:
                test_counts[cls] += 1
            src_counts[src] += 1

    total_train = sum(train_counts.values())
    total_test = sum(test_counts.values())
    print(f'\nFinal v7 combined:')
    print(f'  train: {total_train} files across {len(train_counts)} classes')
    print(f'  test:  {total_test} files across {len(test_counts)} classes')
    print(f'  per class (train): min={min(train_counts.values())}, max={max(train_counts.values())}, mean={total_train/len(train_counts):.0f}')
    print(f'\nSource breakdown (after caps):')
    for k, v in src_counts.items():
        pct = 100 * v / (total_train + total_test)
        print(f'  {k}: {v} ({pct:.1f}%)')


if __name__ == '__main__':
    main()
