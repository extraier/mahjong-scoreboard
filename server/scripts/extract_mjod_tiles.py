#!/usr/bin/env python3
"""Convert MJOD-2136 COCO format to flat tile crops for v6 training.

Extracts each annotated tile as a 224x224 crop (padded if needed), saves to
data/real-tiles-v6/<our_namespace>/<class>/*.jpg. Combines with Camerash +
standing-tile data for v6 ViT fine-tuning.

Strategy: use bbox annotations, extract square crops centered on tile,
resize to 224x224. This preserves enough tile detail for the ViT to learn
real-photo features.

Output:
  data/real-tiles-v6/train/<class>/*.jpg
  data/real-tiles-v6/test/<class>/*.jpg
  Class names match model namespace (1b-9b, 1n-9n, 1p-9p, ew/sw/ww/nw, gd/rd/wd)
"""

import os
import json
import shutil
import random
from pathlib import Path
from collections import Counter, defaultdict

import cv2
import numpy as np
from PIL import Image

random.seed(42)
np.random.seed(42)

# Paths
MJOD_ROOT = Path('/Users/roger/mahjong-scoreboard/models/mjod-2136/coco_mahjong')
MAPPING_FILE = MJOD_ROOT / 'namespace_mapping.json'
OUTPUT_DIR = Path('/Users/roger/mahjong-scoreboard/server/data/real-tiles-v6')
OUTPUT_IMG_SIZE = 224  # ViT input size
TRAIN_FRAC = 0.85      # 85/15 train/test split

# Load mapping
mapping = json.loads(MAPPING_FILE.read_text())['mjod_to_ours']

# Sorted list of all 34 canonical class names
all_classes = sorted(set(mapping.values()))
print(f'Total classes: {len(all_classes)}')
assert len(all_classes) == 34, f'Expected 34 classes, got {len(all_classes)}'

# Build class-to-index map (matches model id2label ordering if alphabetical)
class_to_idx = {c: i for i, c in enumerate(all_classes)}


def extract_tile_crop(img_bgr, bbox, target_size=224):
    """Extract a square tile crop centered on bbox, padded if needed.

    bbox: [x, y, w, h] in image coords
    Returns RGB PIL image at target_size x target_size, or None if invalid.
    """
    h_img, w_img = img_bgr.shape[:2]
    x, y, w, h = bbox

    # Make it square - use the larger dimension
    side = max(w, h)
    # Pad bbox to be square
    cx = x + w / 2
    cy = y + h / 2
    x1 = max(0, int(cx - side / 2))
    y1 = max(0, int(cy - side / 2))
    x2 = min(w_img, int(cx + side / 2))
    y2 = min(h_img, int(cy + side / 2))

    if x2 <= x1 or y2 <= y1:
        return None

    crop = img_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return None

    # Convert to PIL and resize
    crop_pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    # Make square by padding with white if needed
    if crop_pil.size[0] != crop_pil.size[1]:
        size = max(crop_pil.size)
        square = Image.new('RGB', (size, size), (255, 255, 255))
        square.paste(crop_pil, ((size - crop_pil.size[0]) // 2,
                                (size - crop_pil.size[1]) // 2))
        crop_pil = square
    crop_pil = crop_pil.resize((target_size, target_size), Image.BICUBIC)
    return crop_pil


def process_split(json_path, image_dir, split_name, out_dir):
    """Process one COCO split (train/val) and write tile crops to out_dir."""
    coco = json.loads(Path(json_path).read_text())

    # Build category id -> our class name mapping (only IDs 1-34)
    cat_id_to_name = {}
    for cat in coco['categories']:
        if cat['id'] <= 34:
            cat_id_to_name[cat['id']] = mapping[cat['name']]
        else:
            # IDs 35-48 are duplicates of canonical names. Find which one.
            name = cat['name']
            if name in mapping:
                # Find canonical id with same name
                for c in coco['categories']:
                    if c['id'] <= 34 and c['name'] == name:
                        cat_id_to_name[cat['id']] = mapping[c['name']]
                        break

    # Build image id -> filename map
    img_id_to_file = {img['id']: img['file_name'] for img in coco['images']}

    # Group annotations by image
    annotations_by_image = defaultdict(list)
    for ann in coco['annotations']:
        if ann.get('iscrowd', 0):
            continue
        if ann.get('ignore', 0):
            continue
        if ann['category_id'] not in cat_id_to_name:
            continue
        annotations_by_image[ann['image_id']].append(ann)

    print(f'\n[{split_name}] {len(img_id_to_file)} images, {sum(len(v) for v in annotations_by_image.values())} valid annotations')

    class_counts = Counter()
    written = 0
    skipped = 0

    for img_id, anns in annotations_by_image.items():
        img_file = img_id_to_file.get(img_id)
        if img_file is None:
            continue
        img_path = image_dir / img_file
        if not img_path.exists():
            continue

        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            skipped += 1
            continue

        for ann in anns:
            our_name = cat_id_to_name[ann['category_id']]
            crop = extract_tile_crop(img_bgr, ann['bbox'])
            if crop is None:
                skipped += 1
                continue

            class_dir = out_dir / our_name
            class_dir.mkdir(parents=True, exist_ok=True)
            # Use a unique filename
            out_name = f'{Path(img_file).stem}_{ann["id"]}.jpg'
            crop.save(class_dir / out_name, quality=92)
            class_counts[our_name] += 1
            written += 1

    print(f'[{split_name}] wrote {written} crops, skipped {skipped}')
    print(f'[{split_name}] class distribution:')
    for cls in sorted(class_counts.keys()):
        print(f'  {cls}: {class_counts[cls]}')
    return class_counts


def main():
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    (OUTPUT_DIR / 'train').mkdir(parents=True)
    (OUTPUT_DIR / 'test').mkdir(parents=True)

    # Process train and val (use val as test, since COCO val = our test set)
    train_counts = process_split(
        MJOD_ROOT / 'annotations' / 'instances_train2017.json',
        MJOD_ROOT / 'train2017',
        'train',
        OUTPUT_DIR / 'train',
    )
    val_counts = process_split(
        MJOD_ROOT / 'annotations' / 'instances_val2017.json',
        MJOD_ROOT / 'val2017',
        'val',
        OUTPUT_DIR / 'test',
    )

    # Summary
    total_train = sum(train_counts.values())
    total_val = sum(val_counts.values())
    print(f'\n=== MJOD-2136 extracted ===')
    print(f'  train: {total_train} crops across {len(train_counts)} classes')
    print(f'  test:  {total_val} crops across {len(val_counts)} classes')
    print(f'  output: {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
