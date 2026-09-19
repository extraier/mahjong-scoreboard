#!/usr/bin/env python3
"""Confusion analysis: identify which tile classes v4 ViT gets wrong on real photos.

Run with: LOCAL_VISION_MODEL_DIR=/path/to/v4 python3 confusion_analysis.py
"""

import os
os.environ.setdefault('LOCAL_VISION_MODEL_DIR',
    '/Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v4')

import sys
sys.path.insert(0, '/Users/roger/mahjong-scoreboard/server/scripts')

from collections import Counter
import cv2
from PIL import Image

from mahjong_local_inference import TileRecognizer, detect_tile_boxes
from local_vision_recognizer import detect_tile_boxes_yolo, _load_yolo, _nms_combine

_load_yolo()
recognizer = TileRecognizer(device='mps')
print(f'Model: {recognizer.model.name_or_path if hasattr(recognizer.model, "name_or_path") else "?"}')

# Ground truths (verified by user)
GROUND_TRUTHS = {
    'image6': (['W1', 'W2', 'W3', 'W6', 'W7', 'W8'] +  # row 1
               ['W1', 'W1', 'W1', 'W6', 'W7', 'W8', 'W9', 'W9']),  # row 2
    'image7': (['W1', 'W2', 'W3', 'T2', 'T3', 'T4', 'T8', 'T9'] +
               ['F5', 'F5', 'F5', 'F2', 'F2', 'F2']),
}


def classify_tiles(image_path):
    """Hybrid (YOLO + OpenCV) detect + ViT classify each crop."""
    img = cv2.imread(image_path)
    yolo_boxes = detect_tile_boxes_yolo(img, conf_thresh=0.20)
    opencv_boxes = detect_tile_boxes(img)
    boxes = _nms_combine(yolo_boxes, opencv_boxes, iou_thresh=0.5)

    crops = []
    for (x, y, w, h) in boxes:
        crop = img[y:y+h, x:x+w]
        if crop.size > 0:
            crops.append(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)))
        else:
            crops.append(None)

    preds = []
    confs_out = []
    for crop in crops:
        if crop is None:
            continue
        label, conf = recognizer.classify_crop(crop)
        if conf >= 0.30:
            preds.append(label)
            confs_out.append(conf)

    return preds, confs_out, boxes


def confusion_for_image(image_name, image_path, gt_tiles):
    preds, confs, boxes = classify_tiles(image_path)

    print(f'\n=== {image_name} ({image_path}) ===')
    print(f'  YOLO boxes: {len(boxes)}, accepted (conf>=0.30): {len(preds)}')
    print(f'  avg conf: {sum(confs)/max(len(confs),1):.3f}')
    print(f'  ground truth ({len(gt_tiles)} tiles): {sorted(gt_tiles)}')
    print(f'  predictions  ({len(preds)} tiles): {sorted(preds)}')

    gt_counter = Counter(gt_tiles)
    pred_counter = Counter(preds)

    # Match with greedy multiset
    matched_gt = Counter()
    matched_pred = Counter()
    correct = 0
    for tile in sorted(set(gt_tiles) | set(preds)):
        c = min(gt_counter[tile], pred_counter[tile])
        correct += c
        matched_gt[tile] = c
        matched_pred[tile] = c

    total_gt = len(gt_tiles)
    print(f'\n  accuracy: {correct}/{total_gt} = {correct/max(total_gt,1)*100:.1f}%')

    missed = gt_counter - matched_gt
    extra = pred_counter - matched_pred

    if missed:
        print(f'  missed: {dict(missed)}')
    if extra:
        print(f'  false_positives: {dict(extra)}')

    return {'image': image_name, 'correct': correct, 'total_gt': total_gt}


results = []
images = [
    ('image6', '/Users/roger/.hermes/cache/images/img_2defbceb9a12.jpg'),
    ('image7', '/Users/roger/.hermes/cache/images/img_036092db2a07.jpg'),
]
for name, path in images:
    if name in GROUND_TRUTHS:
        results.append(confusion_for_image(name, path, GROUND_TRUTHS[name]))

print('\n=== OVERALL ===')
total_correct = sum(r['correct'] for r in results)
total_gt = sum(r['total_gt'] for r in results)
print(f'{total_correct}/{total_gt} = {total_correct/max(total_gt,1)*100:.1f}%')
for r in results:
    print(f'  {r["image"]}: {r["correct"]}/{r["total_gt"]} = {r["correct"]/max(r["total_gt"],1)*100:.1f}%')
