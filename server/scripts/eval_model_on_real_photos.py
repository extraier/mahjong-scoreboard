#!/usr/bin/env python3
"""
eval_model_on_real_photos.py — measure accuracy of a ViT model against the
real-tiles-2026-09-20/test/ directory (held-out Camerash images, never seen
during training).

For each subdirectory of <test_dir>/<riichi_label>/*.jpg, run the ViT model
and compare prediction to ground truth. Reports:
  - overall accuracy
  - per-class precision/recall
  - confusion matrix (top confused pairs)
  - examples of misclassified tiles

Usage:
  python scripts/eval_model_on_real_photos.py --model-dir <path> --test-dir <path>
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import torch
from PIL import Image
from transformers import ViTImageProcessor, ViTForImageClassification


# Map our notation -> riichi (model labels)
OURS_TO_RIICHI = {}
for n in range(1, 10):
    OURS_TO_RIICHI[f'W{n}'] = f'{n}n'  # man/wan
    OURS_TO_RIICHI[f'T{n}'] = f'{n}p'  # pin/tong
    OURS_TO_RIICHI[f'S{n}'] = f'{n}b'  # sou/bamboo
OURS_TO_RIICHI['F1'] = 'ew'  # east
OURS_TO_RIICHI['F2'] = 'sw'  # south
OURS_TO_RIICHI['F3'] = 'ww'  # west
OURS_TO_RIICHI['F4'] = 'nw'  # north
OURS_TO_RIICHI['F5'] = 'gd'  # green (hatsu) — model output
OURS_TO_RIICHI['F6'] = 'rd'  # red (chun) — model output
OURS_TO_RIICHI['F7'] = 'wd'  # white (haku)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model-dir', required=True)
    p.add_argument('--test-dir', required=True,
                   help='Path to test/ dir containing subdirs by riichi label')
    p.add_argument('--limit', type=int, default=None,
                   help='Optional cap on images per class for quick eval')
    args = p.parse_args()

    print(f'[load] model from {args.model_dir}')
    processor = ViTImageProcessor.from_pretrained(args.model_dir)
    model = ViTForImageClassification.from_pretrained(args.model_dir)
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    model = model.to(device).eval()

    id2label = {int(k): v for k, v in model.config.id2label.items()}

    test_dir = Path(args.test_dir)
    if not test_dir.exists():
        print(f'ERROR: {test_dir} not found')
        sys.exit(1)

    correct = 0
    total = 0
    per_class_correct = defaultdict(int)
    per_class_total = defaultdict(int)
    confusion = Counter()  # (true, pred) -> count
    examples = defaultdict(list)  # (true, pred) -> [filenames]

    for label_dir in sorted(test_dir.iterdir()):
        if not label_dir.is_dir():
            continue
        true_label = label_dir.name
        for img_path in sorted(label_dir.iterdir()):
            if not img_path.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                continue
            if args.limit and per_class_total[true_label] >= args.limit:
                break

            img = Image.open(img_path).convert('RGB')
            inputs = processor(images=img, return_tensors='pt').to(device)
            with torch.no_grad():
                outputs = model(**inputs)
            top_id = int(outputs.logits.argmax(-1)[0])
            pred_label = id2label[top_id]

            total += 1
            per_class_total[true_label] += 1
            if pred_label == true_label:
                correct += 1
                per_class_correct[true_label] += 1
            else:
                confusion[(true_label, pred_label)] += 1
                if len(examples[(true_label, pred_label)]) < 3:
                    examples[(true_label, pred_label)].append(img_path.name)

    print()
    print(f'=== Summary ===')
    print(f'Total: {total} | Correct: {correct} | Accuracy: {correct/total*100:.2f}%')
    print()
    print('Per-class accuracy (sorted):')
    rows = []
    for label in sorted(per_class_total.keys()):
        n_total = per_class_total[label]
        n_correct = per_class_correct[label]
        rows.append((label, n_total, n_correct, n_correct/n_total*100))
    for label, n_total, n_correct, pct in sorted(rows, key=lambda r: r[3]):
        print(f'  {label:>3}: {n_correct:>3}/{n_total:>3} ({pct:5.1f}%)')

    print()
    print('Top confusion pairs (true -> predicted):')
    for (true, pred), count in confusion.most_common(15):
        ex = examples[(true, pred)]
        print(f'  {true:>3} -> {pred:<3}: {count} times   e.g. {ex}')

    print()
    print(f'=== END ===')


if __name__ == '__main__':
    main()
