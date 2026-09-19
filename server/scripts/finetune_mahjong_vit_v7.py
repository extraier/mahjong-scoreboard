#!/usr/bin/env python3
"""Train ViT v7: balanced mix of real-photo + MJOD (capped).

Dataset: data/real-tiles-v7-combined
  - Camerash: 540 (29%) - close-up tile photos
  - mahjong-real-data: 540 (29%) - NEW real tile photos (single tiles, white bg)
  - Standing tiles: 210 (11%) - user's real photo 9 (oversampled 3x)
  - MJOD-2136: 575 (31%) - game screenshots, capped

Total: 1490 train + 375 test across 34 classes (mean 44 per class)

Improvements over v6:
- v6 had 11790 train dominated by MJOD (11000 game screenshots)
- v7 caps MJOD at 50% of real-photos, so gradient is balanced
- Adds mahjong-real-data: 540 new single-tile real photos
- More epochs (5) since data is smaller and balanced

Recipe:
- Start from v5 (not v6) - v5 is closer to real-photo distribution
- LR: 3e-6 (between v5=5e-6 and v6=2e-6)
- 5 epochs (more iterations on smaller dataset)
- Batch size 16 (medium)
- Eval at end of each epoch
"""

import os
os.environ['LOCAL_VISION_MODEL_DIR'] = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v5'

import sys
import random
from pathlib import Path
from collections import Counter

import torch
import numpy as np
from PIL import Image
from transformers import (
    ViTImageProcessor,
    ViTForImageClassification,
    TrainingArguments,
    Trainer,
    DefaultDataCollator,
)
import evaluate


def main():
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    BASE_MODEL = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v5'
    V7_DATA = '/Users/roger/mahjong-scoreboard/server/data/real-tiles-v7-combined'
    OUTPUT_DIR = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v7'

    print(f'[load] loading v5 model from {BASE_MODEL}')
    processor = ViTImageProcessor.from_pretrained(BASE_MODEL)
    model = ViTForImageClassification.from_pretrained(BASE_MODEL)

    # Freeze backbone (preserve real-photo features)
    for name, param in model.named_parameters():
        if 'classifier' not in name:
            param.requires_grad = False
        else:
            param.requires_grad = True
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_total = sum(p.numel() for p in model.parameters())
    print(f'[freeze] Froze backbone. Trainable: {n_trainable:,} / {n_total:,}')

    label2id = {v: int(k) for k, v in model.config.id2label.items()}
    print(f'[data] loading v7 from {V7_DATA}')

    train_paths, train_labels = [], []
    test_paths, test_labels = [], []

    for split, paths_list, labels_list in [('train', train_paths, train_labels),
                                            ('test', test_paths, test_labels)]:
        path_list = []
        label_list = []
        for cls_dir in sorted((Path(V7_DATA) / split).iterdir()):
            if not cls_dir.is_dir():
                continue
            cls = cls_dir.name
            if cls not in label2id:
                print(f'[data] WARN: class "{cls}" not in model classes, skipping')
                continue
            for img in cls_dir.iterdir():
                if img.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                    path_list.append(str(img))
                    label_list.append(label2id[cls])
        if split == 'train':
            train_paths = path_list
            train_labels = label_list
        else:
            test_paths = path_list
            test_labels = label_list

    print(f'[data] train: {len(train_paths)} files')
    print(f'[data] test:  {len(test_paths)} files')

    image_size = processor.size.get('shortest_edge', 224)

    def preprocess(path):
        img = Image.open(path).convert('RGB')
        img = img.resize((image_size, image_size), Image.BICUBIC)
        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array(processor.image_mean, dtype=np.float32)
        std = np.array(processor.image_std, dtype=np.float32)
        arr = (arr - mean) / std
        arr = arr.transpose(2, 0, 1)
        return torch.from_numpy(arr)

    print(f'[preproc] train ({len(train_paths)} images)...')
    train_tensors = [preprocess(p) for p in train_paths]
    print(f'[preproc] test ({len(test_paths)} images)...')
    test_tensors = [preprocess(p) for p in test_paths] if test_paths else []
    print(f'[preproc] done. shape: {train_tensors[0].shape}')

    train_pixel_values = torch.stack(train_tensors)
    train_labels_t = torch.tensor(train_labels, dtype=torch.long)
    test_pixel_values = torch.stack(test_tensors) if test_tensors else None
    test_labels_t = torch.tensor(test_labels, dtype=torch.long) if test_labels else None

    class TensorDataset(torch.utils.data.Dataset):
        def __init__(self, pixel_values, labels):
            self.pixel_values = pixel_values
            self.labels = labels

        def __len__(self):
            return len(self.labels)

        def __getitem__(self, idx):
            return {
                'pixel_values': self.pixel_values[idx],
                'labels': self.labels[idx],
            }

    train_ds = TensorDataset(train_pixel_values, train_labels_t)
    test_ds = TensorDataset(test_pixel_values, test_labels_t) if test_labels else None

    accuracy_metric = evaluate.load('accuracy')

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        return {'accuracy': accuracy_metric.compute(predictions=preds, references=labels)['accuracy']}

    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        remove_unused_columns=False,
        do_eval=bool(test_ds),
        eval_strategy='epoch' if test_ds else 'no',
        save_strategy='epoch',
        save_total_limit=1,
        learning_rate=3e-6,           # Between v5=5e-6 and v6=2e-6
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=1,
        num_train_epochs=5,           # More epochs since dataset is smaller
        logging_strategy='steps',
        logging_steps=20,
        load_best_model_at_end=True if test_ds else False,
        metric_for_best_model='accuracy',
        report_to='none',
        weight_decay=0.01,
        dataloader_num_workers=0,
        warmup_steps=20,             # Add warmup for stability
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

    print('[train] starting v7 training')
    trainer.train()

    print(f'[save] saving v7 to {OUTPUT_DIR}')
    trainer.save_model(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)
    print('[done] v7 fine-tuning complete')


if __name__ == '__main__':
    main()
