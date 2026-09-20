#!/usr/bin/env python3
"""Convert RaesakAce/riichi_mahjong_tiles → our training format.

Source: https://github.com/RaesakAce/riichi_mahjong_tiles
- cropped_images/ has 444 tile photos (164×220) from a Xiaomi Redmi Note 8 Pro
- Naming: <type>_<num>_<sample>.jpg  where:
    type ∈ m (萬/characters), p (筒/dots), s (索/bamboo),
           east/south/west/north (winds), chun/haku/hatsu (dragons),
           red_5_m/p/s (red fives)
    num ∈ 1-9 for suits, N/A for honors
    sample ∈ 0-11 (rotation/perspective)

Maps to our 34-class label space:
- m_X → C_X (萬X, 1-9)
- p_X → D_X (筒X, 1-9)
- s_X → B_X (索X, 1-9)
- east/south/west/north → WE/WS/WW/WN (winds)
- chun/haku/hatsu → DR/... actually: chun=Red dragon, hatsu=Green dragon, haku=White dragon
- red_5_m → C_5r (red 五萬), red_5_p → D_5r (red 五筒), red_5_s → B_5r (red 五索)

NOTE: in HK mahjong (Cantonese), there's no "red 5" tile — they're all standard.
For training we map red_5_X → X_5 (same class) since they have the same number.

Output: server/data/real-tiles-v12-raesakace/train/<class>/*.jpg + test split.
"""
import os
import shutil
from pathlib import Path
import random

SRC = Path('/tmp/riichi_mahjong_tiles/cropped_images')
DST = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v12-raesakace')
TRAIN_RATIO = 0.85

# Mapping: riichi label → our 34-class label
# Our 34 classes: C1-9 (萬), B1-9 (索), D1-9 (筒), WE/WS/WW/WN (winds), AR/AG/AW (dragons), F1-4 (flowers)
def to_class(prefix: str) -> str | None:
    """Map 'm_5', 'p_5', 'east', 'chun', 'red_5_m' etc to our class name.

    Riichi naming convention (verified via vision-describe on samples):
    - m_0 = 中 (red dragon / AR), m_1-9 = 1-9 萬 (C1-C9)
    - p_0 = 發 (green dragon / AG), p_1-9 = 1-9 筒 (D1-D9)
    - s_0 = 白 (white dragon / AW), s_1-9 = 1-9 索 (B1-B9)
    - east/south/west/north → WE/WS/WW/WN
    - chun/haku/hatsu → AR/AG/AW  (note: chun=中/red, haku=白/white, hatsu=發/green)
    - red_5_X → same as X_5 (no separate red-5 class in our scheme)
    """
    parts = prefix.split('_')
    p = parts[0]
    if p == 'm':
        n = int(parts[1])
        if n == 0:
            return 'AR'   # 中 (red dragon) lives at m_0
        return f'C{n}'   # C1..C9
    elif p == 'p':
        n = int(parts[1])
        if n == 0:
            return 'AG'   # 發 (green dragon) lives at p_0
        return f'D{n}'   # D1..D9
    elif p == 's':
        n = int(parts[1])
        if n == 0:
            return 'AW'   # 白 (white dragon) lives at s_0
        return f'B{n}'   # B1..B9
    elif p == 'east':
        return 'WE'
    elif p == 'south':
        return 'WS'
    elif p == 'west':
        return 'WW'
    elif p == 'north':
        return 'WN'
    elif p == 'chun':
        return 'AR'  # Red dragon (中)
    elif p == 'haku':
        return 'AW'  # White dragon (白)
    elif p == 'hatsu':
        return 'AG'  # Green dragon (發)
    elif p == 'red_5':
        # red_5_m → C_5, red_5_p → D_5, red_5_s → B_5
        suit = parts[2]
        if suit == 'm':
            return 'C5'
        elif suit == 'p':
            return 'D5'
        elif suit == 's':
            return 'B5'
    return None  # Unknown


def main():
    if DST.exists():
        shutil.rmtree(DST)
    (DST / 'train').mkdir(parents=True)
    (DST / 'test').mkdir(parents=True)

    # Group files by class
    by_class: dict[str, list[Path]] = {}
    skipped = []
    for f in sorted(SRC.glob('*.jpg')):
        # Parse: m_5_3.jpg → prefix=m_5
        stem = f.stem  # e.g. m_5_3
        parts = stem.split('_')
        # Special case: red_5_m_0
        if parts[0] == 'red':
            prefix = '_'.join(parts[:3])  # red_5_m
        else:
            # m, p, s have 3 parts: m_5_3
            # east/south/etc have 2: east_3
            if parts[0] in ('m', 'p', 's'):
                prefix = '_'.join(parts[:2])  # m_5
            else:
                prefix = parts[0]  # east, chun, etc
        cls = to_class(prefix)
        if cls is None:
            skipped.append(f.name)
            continue
        by_class.setdefault(cls, []).append(f)

    # Split train/test (deterministic seed for reproducibility)
    rng = random.Random(42)
    counts = {}
    for cls, files in sorted(by_class.items()):
        rng.shuffle(files)
        n_train = max(1, int(len(files) * TRAIN_RATIO))
        train_files = files[:n_train]
        test_files = files[n_train:] if len(files) > 1 else files[:1]  # ensure at least 1 test
        (DST / 'train' / cls).mkdir(parents=True, exist_ok=True)
        (DST / 'test' / cls).mkdir(parents=True, exist_ok=True)
        for f in train_files:
            shutil.copy(f, DST / 'train' / cls / f.name)
        for f in test_files:
            shutil.copy(f, DST / 'test' / cls / f.name)
        counts[cls] = (len(train_files), len(test_files))

    print(f'Skipped {len(skipped)} files: {skipped[:5]}...')
    print(f'\nClass | train | test')
    print('------|-------|------')
    total_train = total_test = 0
    for cls in sorted(counts.keys()):
        tr, te = counts[cls]
        total_train += tr
        total_test += te
        print(f'  {cls:4} | {tr:5} | {te:4}')
    print(f'------|-------|------')
    print(f'  {len(counts)} cls | {total_train:5} | {total_test:4}')
    print(f'\nOutput: {DST}')


if __name__ == '__main__':
    main()
