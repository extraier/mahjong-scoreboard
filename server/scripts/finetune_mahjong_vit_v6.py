#!/usr/bin/env python3
"""Train ViT v6: Camerash + MJOD-2136 + standing tiles.

Dataset:
  data/real-tiles-v6-combined/train|test/<class>/*.jpg
  Total: 11790 train + 3493 test across 34 classes
  Mean 347 samples per class (max 425, min 268)

Improvements over v5:
- MJOD-2136 adds 11181 train + 3352 test real photos (5x more data)
- MJOD covers all 34 classes including flowers? Actually no flowers per subagent
- Should generalize better than v5 (which had only 540 Camerash + 210 standing)

Strategy:
- Same as v5: freeze backbone, train classifier head only
- Lower LR (2e-6) - even smaller to avoid catastrophic forgetting of v5 features
- 2 epochs (more data = fewer epochs needed)
- Larger batch size possible since we have more data
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

    # Paths
    BASE_MODEL = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v5'
    V6_DATA = '/Users/roger/mahjong-scoreboard/server/data/real-tiles-v6-combined'
    OUTPUT_DIR = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v6'

    print(f'[load] loading v5 model from {BASE_MODEL}')
    processor = ViTImageProcessor.from_pretrained(BASE_MODEL)
    model = ViTForImageClassification.from_pretrained(BASE_MODEL)

    # Freeze backbone (lessons from v2/v3 catastrophic forgetting)
    for name, param in model.named_parameters():
        if 'classifier' not in name:
            param.requires_grad = False
        else:
            param.requires_grad = True
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_total = sum(p.numel() for p in model.parameters())
    print(f'[freeze] Froze backbone. Trainable: {n_trainable:,} / {n_total:,}')

    # Load v6 dataset
    print(f'[data] loading v6 from {V6_DATA}')
    label2id = {v: int(k) for k, v in model.config.id2label.items()}
    id2label = model.config.id2label
    print(f'[data] Model class mapping: {label2id}')

    train_paths, train_labels = [], []
    test_paths, test_labels = [], []

    for split, paths_list, labels_list in [('train', train_paths, train_labels),
                                            ('test', test_paths, test_labels)]:
        path_list = []
        label_list = []
        for cls_dir in sorted((Path(V6_DATA) / split).iterdir()):
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

    # Preprocess all images upfront (avoids PngImageFile + set_transform issues)
    print('[preproc] preprocessing all images to tensors...')
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
        learning_rate=2e-6,  # Lower than v5's 5e-6 since more data
        per_device_train_batch_size=32,  # Larger batch since more data
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=1,
        num_train_epochs=2,
        logging_strategy='steps',
        logging_steps=50,
        load_best_model_at_end=True if test_ds else False,
        metric_for_best_model='accuracy',
        report_to='none',
        weight_decay=0.01,
        dataloader_num_workers=0,
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

    print(f'[save] saving v6 to {OUTPUT_DIR}')
    trainer.save_model(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)
    print('[done] v6 fine-tuning complete')


if __name__ == '__main__':
    main()
