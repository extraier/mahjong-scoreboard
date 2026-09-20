#!/usr/bin/env python3
"""Train ViT v12: v10 real-photo data + RaesakAce Xiaomi-phone photos.

Hypothesis: v5/v10 hit 92.9% ceiling because all real-photo data comes from
similar sources (Camerash/mahjongreal). RaesakAce adds Xiaomi-phone photos
from a different camera + angle + lighting. Even with just 444 extra tiles,
the diversity might be enough to break the systematic W4↔W1, W6↔W5, T7↔T6
confusions.

Data:
- real-tiles-v10-real-only: 884 train + 231 test (Camerash + mahjongreal)
- real-tiles-v12-raesakace: 370 train + 74 test (Xiaomi Redmi Note 8 Pro)
- Combined: 1254 train + 305 test (40% more data, 1 new camera source)

Key changes from v10:
- Input resolution 224×224 (back to v10 setup — v11 at 384 didn't help)
- Same data format as v10 (just additional source mixed in)
- 5 epochs (small additional data, same compute as v10)
- Same logit-bias correction can be applied at inference
"""
import os
import sys
import time
from pathlib import Path

os.environ['HF_HOME'] = '/Users/roger/mahjong-scoreboard/server/.cache/huggingface'

import torch
from torch.utils.data import Dataset
from transformers import (
    ViTForImageClassification,
    ViTImageProcessor,
    TrainingArguments,
    Trainer,
)
from sklearn.metrics import accuracy_score
from PIL import Image

V10_DATA = '/Users/roger/mahjong-scoreboard/server/data/real-tiles-v10-real-only'
V12_DATA = '/Users/roger/mahjong-scoreboard/server/data/real-tiles-v12-raesakace'
OUTPUT_DIR = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v12-raesakace'
MODEL_NAME = 'google/vit-base-patch16-224'
NUM_EPOCHS = 5
BATCH_SIZE = 16
LR = 5e-5


class TileDataset(Dataset):
    def __init__(self, root, split, class_to_idx, processor):
        self.samples = []
        self.class_to_idx = class_to_idx
        self.processor = processor
        for root_path in root if isinstance(root, list) else [root]:
            split_dir = Path(root_path) / split
            if not split_dir.exists():
                print(f'  warn: {split_dir} does not exist, skipping')
                continue
            for cls_dir in sorted(split_dir.iterdir()):
                if cls_dir.is_dir():
                    cls_name = cls_dir.name
                    if cls_name not in class_to_idx:
                        continue
                    for img_path in cls_dir.glob('*.jpg'):
                        self.samples.append((str(img_path), class_to_idx[cls_name]))
                    for img_path in cls_dir.glob('*.png'):
                        self.samples.append((str(img_path), class_to_idx[cls_name]))
                    for img_path in cls_dir.glob('*.jpeg'):
                        self.samples.append((str(img_path), class_to_idx[cls_name]))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert('RGB')
        pixel = self.processor(images=img, return_tensors='pt')['pixel_values'][0]
        return {'pixel_values': pixel, 'label': label}


def main():
    print('=== ViT v12 (combined real-photo data) trainer ===\n')
    t0 = time.time()

    train_dir = Path(V10_DATA) / 'train'
    classes = sorted([d.name for d in train_dir.iterdir() if d.is_dir()])
    class_to_idx = {c: i for i, c in enumerate(classes)}
    print(f'Classes ({len(classes)}):', classes[:10], '...')
    assert len(classes) == 34, f'Expected 34 classes, got {len(classes)}'

    print(f'\nLoading processor + model from {MODEL_NAME}...')
    processor = ViTImageProcessor.from_pretrained(MODEL_NAME)
    model = ViTForImageClassification.from_pretrained(
        MODEL_NAME,
        num_labels=34,
        ignore_mismatched_sizes=True,
    )
    model.classifier = torch.nn.Linear(model.config.hidden_size, 34)

    print(f'Trainable params: {sum(p.numel() for p in model.parameters() if p.requires_grad):,}')

    train_ds = TileDataset([V10_DATA, V12_DATA], 'train', class_to_idx, processor)
    test_ds = TileDataset([V10_DATA, V12_DATA], 'test', class_to_idx, processor)
    print(f'\nTrain samples: {len(train_ds)} (v10: ~884 + v12: ~370)')
    print(f'Test samples: {len(test_ds)}')

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        return {'accuracy': accuracy_score(labels, preds)}

    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        learning_rate=LR,
        weight_decay=0.01,
        eval_strategy='epoch',
        save_strategy='epoch',
        save_total_limit=1,
        logging_steps=20,
        load_best_model_at_end=True,
        metric_for_best_model='accuracy',
        greater_is_better=True,
        warmup_steps=20,
        report_to='none',
        dataloader_num_workers=2,
        remove_unused_columns=False,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=test_ds,
        compute_metrics=compute_metrics,
        processing_class=processor,
    )

    print(f'\nTraining for {NUM_EPOCHS} epochs...')
    trainer.train()

    print(f'\nSaving to {OUTPUT_DIR}...')
    trainer.save_model(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)

    elapsed = time.time() - t0
    print(f'\n✓ v12 training complete in {elapsed/60:.1f} min')
    print(f'  Model saved: {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
