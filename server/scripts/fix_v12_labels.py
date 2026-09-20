#!/usr/bin/env python3
"""
Post-hoc fix v12's id2label mapping.

The finetuner trained on 34 RaesakAce folders (AG, AR, AW, B1..B9, C1..C9,
D1..D9, WE, WN, WS, WW) sorted alphabetically, but the model checkpoint
saved `id2label` as generic LABEL_0..LABEL_33 because the trainer script
didn't propagate the class_names to the model config.

This script:
  1. Loads the model
  2. Sets the proper id2label/label2id mapping (matching the sorted folder
     order, which is what the trained classifier weights assume)
  3. Saves it back to disk

The new labels use the same scheme as v5 (1m, 2p, ew, rd, etc.) so
RIICHI_TO_OURS in mahjong_local_inference.py Just Works without any code
change in the backup fallback logic.

After this, v12 can be wired as a confidence-fallback in local_vision_server.py
via LOCAL_VISION_BACKUP_MODEL_DIR (work done in commit 1, but reverted because
of this label bug).
"""

import os
import sys
from pathlib import Path

from transformers import ViTForImageClassification

V12_DIR = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v12-raesakace'

# Match the alphabetical sort the trainer used
#   sorted(['AG', 'AR', 'AW', 'B1', 'B2', ..., 'B9', 'C1', ..., 'C9',
#           'D1', ..., 'D9', 'WE', 'WN', 'WS', 'WW'])
# → 34 classes.
FOLDERS_SORTED = [
    'AG', 'AR', 'AW',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
    'WE', 'WN', 'WS', 'WW',
]

# Map RaesakAce folder name → riichi label (matching v5's id2label scheme so
# RIICHI_TO_OURS in mahjong_local_inference.py resolves correctly).
#
# RaesakAce conventions:
#   B = bamboo (萬/man)
#   C = characters (索/sou)  [s in our scheme]
#   D = dots (筒/pin)        [p in our scheme]
#   W = winds (WE=east, WN=north, WS=south, WW=west)
#   A = dora/honor (AG=green, AR=red, AW=white)
FOLDER_TO_RIICHI = {
    'AG': 'gd',  # green dragon
    'AR': 'rd',  # red dragon
    'AW': 'wd',  # white dragon
    # B1-B9 = 1-9 wan (man, m)
    **{f'B{i}': f'{i}m' for i in range(1, 10)},
    # C1-C9 = 1-9 sou (s)
    **{f'C{i}': f'{i}s' for i in range(1, 10)},
    # D1-D9 = 1-9 pin (p)
    **{f'D{i}': f'{i}p' for i in range(1, 10)},
    # Winds
    'WE': 'ew',  # east
    'WN': 'nw',  # north
    'WS': 'sw',  # south
    'WW': 'ww',  # west
}

assert len(FOLDERS_SORTED) == 34, f'expected 34, got {len(FOLDERS_SORTED)}'
assert len(FOLDER_TO_RIICHI) == 34

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--check':
        # Just inspect, don't modify
        m = ViTForImageClassification.from_pretrained(V12_DIR)
        print('Current v12 id2label:')
        for k, v in sorted(m.config.id2label.items()):
            print(f'  {k}: {v}')
        return

    print(f'Loading v12 from {V12_DIR}...')
    model = ViTForImageClassification.from_pretrained(V12_DIR)

    # Build id2label: idx → riichi_label (which RIICHI_TO_OURS expects)
    id2label = {}
    label2id = {}
    for idx, folder in enumerate(FOLDERS_SORTED):
        riichi_label = FOLDER_TO_RIICHI[folder]
        id2label[str(idx)] = riichi_label
        label2id[riichi_label] = idx

    model.config.id2label = id2label
    model.config.label2id = label2id

    print('New v12 id2label:')
    for k, v in sorted(model.config.id2label.items()):
        print(f'  {k}: {v}')

    print(f'Saving back to {V12_DIR}...')
    model.save_pretrained(V12_DIR)
    print('✓ Done. v12 now has riichi labels matching v5.')

if __name__ == '__main__':
    main()
