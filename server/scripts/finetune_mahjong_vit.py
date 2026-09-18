#!/usr/bin/env python3
"""
finetune_mahjong_vit.py — continue training krmin/mahjong_vision on real tile photos.

Strategy:
  1. Start from krmin/mahjong_vision (already 99.6% on Mahjong Soul graphics)
  2. Fine-tune on user's real tile photos + mahjong_souls_tiles (already downloaded)
  3. Use short epochs (5-10) — not the original 250
  4. Save fine-tuned model to models/mahjong-vision-finetuned/

Why this should help:
  - Original model overfit to Mahjong Soul in-app graphics
  - Real photos differ in color saturation, lighting, angle
  - Even 5-10 epochs of additional real-photo data adapts the classifier
"""

import argparse
import os
from pathlib import Path
import torch
from datasets import load_dataset, Dataset
from transformers import (
    ViTImageProcessor,
    ViTForImageClassification,
    TrainingArguments,
    Trainer,
    DefaultDataCollator,
)
import evaluate


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--base-model', default='/Users/roger/mahjong-scoreboard/models/mahjong-vision-krmin/vision_transformer_local')
    p.add_argument('--souls-tiles', default='/Users/roger/mahjong-scoreboard/models/mahjong-souls-tiles/dataset')
    p.add_argument('--real-photos-dir', default=None, help='Optional dir with subdirs named by tile label (1n, 2n, ...) for additional fine-tuning data')
    p.add_argument('--output-dir', default='/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned')
    p.add_argument('--epochs', type=int, default=5)
    p.add_argument('--batch-size', type=int, default=8)
    p.add_argument('--learning-rate', type=float, default=2e-5)
    return p.parse_args()


def load_souls_tiles(souls_dir: str, image_processor):
    """Load the mahjong_souls_tiles dataset from local filesystem."""
    print(f'[data] loading mahjong_souls_tiles from {souls_dir}')
    train_dir = Path(souls_dir) / 'train'
    classes = sorted([d.name for d in train_dir.iterdir() if d.is_dir()])
    print(f'[data] found {len(classes)} classes: {classes}')

    label2id = {c: i for i, c in enumerate(classes)}
    id2label = {i: c for c, i in label2id.items()}

    train_paths = []
    train_labels = []
    for c in classes:
        for f in (train_dir / c).iterdir():
            if f.suffix.lower() in ('.png', '.jpg', '.jpeg'):
                train_paths.append(str(f))
                train_labels.append(label2id[c])

    test_dir = Path(souls_dir) / 'test'
    test_paths = []
    test_labels = []
    if test_dir.exists():
        for c in classes:
            for f in (test_dir / c).iterdir():
                if f.suffix.lower() in ('.png', '.jpg', '.jpeg'):
                    test_paths.append(str(f))
                    test_labels.append(label2id[c])

    print(f'[data] train={len(train_paths)} test={len(test_paths)}')
    return train_paths, train_labels, test_paths, test_labels, label2id, id2label


RIICHI_FROM_OURS = {
    **{f'W{n}': f'{n}n' for n in range(1, 10)},
    **{f'T{n}': f'{n}p' for n in range(1, 10)},
    **{f'S{n}': f'{n}b' for n in range(1, 10)},
    'F1': 'ew', 'F2': 'sw', 'F3': 'ww', 'F4': 'nw',
    'F5': 'gd', 'F6': 'rd', 'F7': 'wd',
}


def load_real_photos(real_dir: str, label2id):
    """Load real tile photos from user-supplied dir. Subdir names match
    label2id keys (which use riichi notation: 1n, ew, gd, etc.).

    Real photo subdirs may use our notation (W1, F1, F5) — auto-translated.
    """
    if not real_dir or not os.path.isdir(real_dir):
        return [], []
    paths = []
    labels = []
    for c in sorted(os.listdir(real_dir)):
        cpath = os.path.join(real_dir, c)
        if not os.path.isdir(cpath):
            continue
        # Translate our notation → riichi
        riichi_label = RIICHI_FROM_OURS.get(c, c)
        if riichi_label not in label2id:
            print(f'[data] WARN: real-photo class "{c}" (riichi: "{riichi_label}") not in model classes — skipping')
            continue
        for f in os.listdir(cpath):
            if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                paths.append(os.path.join(cpath, f))
                labels.append(label2id[riichi_label])
    print(f'[data] real photos: {len(paths)}')
    return paths, labels


def make_dataset(paths, labels, processor, id2label):
    """Build a HuggingFace Dataset from image paths + labels."""
    if not paths:
        return None
    from PIL import Image

    def gen():
        for p, l in zip(paths, labels):
            try:
                img = Image.open(p).convert('RGB')
                yield {'image': img, 'label': l}
            except Exception as e:
                print(f'[data] WARN: failed to load {p}: {e}')

    ds = Dataset.from_generator(gen)
    ds = ds.cast_column('image', ds.features['image'])

    normalize_mean = processor.image_mean
    normalize_std = processor.image_std
    size = (processor.size['shortest_edge'] if 'shortest_edge' in processor.size
            else (processor.size['height'], processor.size['width']))

    from torchvision.transforms import Compose, Normalize, ToTensor, Resize
    transforms = Compose([Resize(size), ToTensor(), Normalize(normalize_mean, normalize_std)])

    def transform(examples):
        out = []
        for img in examples['image']:
            t = transforms(img)
            out.append(t)
        examples['pixel_values'] = out
        del examples['image']
        return examples

    ds.set_transform(transform)
    return ds


def main():
    args = parse_args()

    print('[load] base model from', args.base_model)
    processor = ViTImageProcessor.from_pretrained(args.base_model)
    model = ViTForImageClassification.from_pretrained(args.base_model)
    print(f'[load] num_labels = {model.config.num_labels}, id2label sample = {dict(list(model.config.id2label.items())[:3])}')

    print('[data] loading training data...')
    train_paths, train_labels, test_paths, test_labels, label2id, id2label = load_souls_tiles(args.souls_tiles, processor)

    if args.real_photos_dir:
        rp, rl = load_real_photos(args.real_photos_dir, label2id)
        train_paths.extend(rp)
        train_labels.extend(rl)
        print(f'[data] total after real-photo merge: {len(train_paths)}')

    train_ds = make_dataset(train_paths, train_labels, processor, id2label)
    test_ds = make_dataset(test_paths, test_labels, processor, id2label) if test_paths else None

    accuracy_metric = evaluate.load('accuracy')

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        return {'accuracy': accuracy_metric.compute(predictions=preds, references=labels)['accuracy']}

    print('[train] setting up TrainingArguments')
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        remove_unused_columns=False,
        do_eval=bool(test_ds),
        eval_strategy='epoch' if test_ds else 'no',
        save_strategy='epoch',
        save_total_limit=2,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=2,
        num_train_epochs=args.epochs,
        logging_strategy='steps',
        logging_steps=10,
        load_best_model_at_end=True if test_ds else False,
        metric_for_best_model='accuracy',
        report_to='none',
    )

    data_collator = DefaultDataCollator()

    trainer = Trainer(
        model=model,
        args=training_args,
        data_collator=data_collator,
        train_dataset=train_ds,
        eval_dataset=test_ds,
        processing_class=processor,
        compute_metrics=compute_metrics if test_ds else None,
    )

    print('[train] starting training')
    trainer.train()

    print('[save] saving fine-tuned model to', args.output_dir)
    trainer.save_model(args.output_dir)
    processor.save_pretrained(args.output_dir)

    print('[done] fine-tuning complete')


if __name__ == '__main__':
    main()
