#!/usr/bin/env python3
"""Train ViT v10: focal loss + class weights to fix F7/S1/W5 over-prediction.

Key changes from v9:
- focal_loss (gamma=2.0) to focus on hard examples, ignore easy/over-confident
- Class weights computed from v5 prediction distribution on complete sets
  (down-weight over-predicted classes: F7, S1, W5, F2)
- Same v7 dataset
- Started from v5 (not v8) to avoid drift
"""

import os
os.environ['LOCAL_VISION_MODEL_DIR'] = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v5'

import sys
import random
import math
from pathlib import Path
from collections import Counter

import torch
import torch.nn.functional as F
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


def focal_loss(logits, labels, alpha=None, gamma=2.0):
    """Focal loss for multi-class.
    alpha: per-class weight tensor (shape [num_classes]) or None
    gamma: focusing parameter (default 2.0)
    """
    ce_loss = F.cross_entropy(
        logits, labels, weight=alpha, reduction='none'
    )
    pt = torch.exp(-ce_loss)  # probability of true class
    focal = ((1 - pt) ** gamma) * ce_loss
    return focal.mean()


def main():
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    BASE_MODEL = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v5'
    V10_DATA = '/Users/roger/mahjong-scoreboard/server/data/real-tiles-v10-real-only'
    OUTPUT_DIR = '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v10'

    print(f'[load] loading v5 model from {BASE_MODEL}')
    processor = ViTImageProcessor.from_pretrained(BASE_MODEL)
    model = ViTForImageClassification.from_pretrained(BASE_MODEL)

    # Get class names
    id2label = model.config.id2label
    label2id = {v: int(k) for k, v in id2label.items()}
    num_classes = len(id2label)

    # Compute class weights based on v5 prediction bias
    # v5 over-predicts: F7 (red dragon), S1 (1 bamboo), W5 (5 man), F2 (2 dots)
    # Down-weight these by 0.5x, up-weight under-predicted by 1.5x
    print('[weights] computing class weights to counter over-prediction bias')
    class_weights = torch.ones(num_classes)
    for cls, idx in label2id.items():
        if cls in ['F7', 'S1', 'W5', 'F2', 'T1', 'T2']:  # Over-predicted
            class_weights[idx] = 0.5
        elif cls in ['T7', 'T6', 'W4', 'W6', 'gd', 'rd']:  # Under-predicted
            class_weights[idx] = 1.5
    print(f'[weights] weights range: {class_weights.min().item():.2f} to {class_weights.max().item():.2f}')

    # Freeze backbone
    for name, param in model.named_parameters():
        if 'classifier' not in name:
            param.requires_grad = False
        else:
            param.requires_grad = True

    train_paths, train_labels = [], []
    test_paths, test_labels = [], []

    for split, paths_list, labels_list in [('train', train_paths, train_labels),
                                            ('test', test_paths, test_labels)]:
        path_list = []
        label_list = []
        for cls_dir in sorted((Path(V10_DATA) / split).iterdir()):
            if not cls_dir.is_dir():
                continue
            cls = cls_dir.name
            if cls not in label2id:
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

    print(f'[data] train: {len(train_paths)} files, test: {len(test_paths)} files')

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

    train_tensors = [preprocess(p) for p in train_paths]
    test_tensors = [preprocess(p) for p in test_paths] if test_paths else []
    train_pixel_values = torch.stack(train_tensors)
    train_labels_t = torch.tensor(train_labels, dtype=torch.long)
    test_pixel_values = torch.stack(test_tensors) if test_tensors else None
    test_labels_t = torch.tensor(test_labels, dtype=torch.long) if test_labels else None

    class TensorDataset(torch.utils.data.Dataset):
        def __init__(self, pixel_values, labels):
            self.pixel_values = pixel_values
            self.labels = labels
        def __len__(self): return len(self.labels)
        def __getitem__(self, idx):
            return {'pixel_values': self.pixel_values[idx],
                    'labels': self.labels[idx]}

    train_ds = TensorDataset(train_pixel_values, train_labels_t)
    test_ds = TensorDataset(test_pixel_values, test_labels_t) if test_labels else None

    accuracy_metric = evaluate.load('accuracy')

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = logits.argmax(-1)
        return {'accuracy': accuracy_metric.compute(predictions=preds, references=labels)['accuracy']}

    def compute_loss(outputs, labels, num_items_in_batch=None):
        """Custom loss with focal + class weights.
        Note: Trainer calls compute_loss_func(outputs, labels, num_items_in_batch)
        outputs is a ModelOutput, labels is the labels tensor.
        """
        logits = outputs.logits
        loss = focal_loss(logits, labels, alpha=class_weights.to(logits.device), gamma=2.0)
        return loss

    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        remove_unused_columns=False,
        do_eval=bool(test_ds),
        eval_strategy='epoch' if test_ds else 'no',
        save_strategy='epoch',
        save_total_limit=1,
        learning_rate=3e-6,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        gradient_accumulation_steps=1,
        num_train_epochs=8,
        logging_strategy='steps',
        logging_steps=20,
        load_best_model_at_end=True if test_ds else False,
        metric_for_best_model='accuracy',
        report_to='none',
        weight_decay=0.01,
        dataloader_num_workers=0,
        warmup_steps=30,
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
        compute_loss_func=compute_loss,
    )

    print('[train] starting v10 training (focal loss + class weights)')
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)
    print('[done] v10 complete')


if __name__ == '__main__':
    main()
