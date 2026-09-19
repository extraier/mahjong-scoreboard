#!/usr/bin/env python3
"""
evaluate_finetune.py — compare two ViT models on the same test image.

Usage:
  python evaluate_finetune.py <image_path> [--model-a PATH] [--model-b PATH]

Default models:
  model-a: /Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned    (v1)
  model-b: /Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v2 (v2)

Outputs side-by-side detection: same image, two model predictions.
"""

import argparse
import sys
from pathlib import Path
import torch
from PIL import Image
from transformers import ViTForImageClassification, ViTImageProcessor


OUR_NOTATION = {
    **{f'{n}b': f'D{n}' for n in range(1, 10)},
    **{f'{n}n': f'W{n}' for n in range(1, 10)},
    **{f'{n}p': f'T{n}' for n in range(1, 10)},
    'ew': 'F1', 'sw': 'F2', 'ww': 'F3', 'nw': 'F4',
    'gd': 'F5', 'rd': 'F6', 'wd': 'F7',  # F6=中, F7=白 (HK: only F1-F4; F5/F6/F7 are dragons)
}


def map_label(riichi_label: str) -> str:
    return OUR_NOTATION.get(riichi_label, riichi_label)


def detect_via_inline_box_detector(model, processor, image: Image.Image, device='mps'):
    """Reuse the same TileRecognizer logic — load via mahjong_local_inference to be
    honest about the production path."""
    # Just one-shot: resize, classify, return top-1 label + conf for the WHOLE image.
    # (Note: full crop-by-crop evaluation needs the pipeline; this is for sanity check.)
    pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument('image')
    p.add_argument('--model-a', default='/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned')
    p.add_argument('--model-b', default='/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v2')
    args = p.parse_args()

    img = Image.open(args.image).convert('RGB')
    print(f'Image: {args.image}')
    print(f'  size = {img.size}, mode = {img.mode}')

    for label, path in [('v1', args.model_a), ('v2', args.model_b)]:
        if not Path(path).exists():
            print(f'\n[{label}] model not found at {path} — skipping')
            continue
        print(f'\n[{label}] Loading {path}...')
        processor = ViTImageProcessor.from_pretrained(path)
        model = ViTForImageClassification.from_pretrained(path).to('mps')
        model.eval()

        # Classify each tile-crop — but we don't know boxes from this script.
        # Use a single pass: classify the whole image as one tile.
        # Real accuracy comes from the production pipeline via /api/vision/analyze.
        inputs = processor(images=img, return_tensors='pt').to('mps')
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
            probs = torch.nn.functional.softmax(logits, dim=-1)
            top5 = torch.topk(probs, 5)

        for i, (p, idx) in enumerate(zip(top5.values[0], top5.indices[0])):
            riichi = model.config.id2label[int(idx)]
            ours = map_label(riichi)
            print(f'  top{i+1}: {riichi:>5} ({ours})  prob={p.item():.4f}')


if __name__ == '__main__':
    main()
