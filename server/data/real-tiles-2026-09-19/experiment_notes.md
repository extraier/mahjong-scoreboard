# Fine-tune Experiment Notes (2026-09-19)

## TL;DR
- Goal: improve ViT real-photo accuracy by adding user-supplied crops.
- Result: **FAILED** to improve — both v2 (3 epochs lr 1e-5) and v3 (1 epoch lr 5e-6)
  caused catastrophic forgetting on classes not present in the 15 fresh crops.
- Action: keep `models/mahjong-vision-finetuned` (v1) as production. v2/v3 moved
  to `EXPERIMENT-mahjong-vision-finetuned-{v2,v3}` to prevent accidental use.

## Datasets
| dataset | images per class | role |
|---|---|---|
| `mahjong-souls-tiles` | 17-80 (avg 32) | pre-training for v1 |
| `data/real-tiles-2026-09-19/train/` | 1-6 fresh crops | attempted fine-tune data |
| **combined for fine-tune** | ~1075 | **imbalanced 15:1054** |

## Fine-tune runs
| run | epochs | lr | batch | souls_acc | image1 | image2 | image3 |
|---|---|---|---|---|---|---|---|
| **v1 (no FT)** | - | - | - | (n/a) | **7 tiles ✓** | 8 tiles | 9 tiles |
| v2 | 3 | 1e-5 | 8 | 0.9932 | **1 ✗** | 8 | 8 |
| v3 | 1 | 5e-6 | 4 | - | **1 ✗** | 8 | 9 |

## Root cause
The fine-tune script trains ALL ViT weights without freezing. With 15 fresh crops
the gradient signal for `W1, T4, F1, D1, D2, D3` dominates, but other classes
(W2-W9, T1-T3, T5-T9, D4-D9, F2-F4, J2, J3) lose representation. Image 1 had
`W1, T4, F1` — only W1 was preserved in v2/v3 (probably because W1 was most
frequent in our 15 crops).

## Lessons
1. **Don't trust souls_tiles eval accuracy alone** — that dataset has 1054 in-app
   graphics, doesn't reflect real-photo performance.
2. **For fine-tuning ViT with new classes you need**:
   - 50+ real-photo samples per class (we have 1-6, way short)
   - Freeze backbone, only train classifier head
   - Lower LR (1e-6 to 5e-6)
   - Held-out test set on REAL photos, not souls
3. **Multi-row compositions** (>1 row of tiles) are an unsolved problem — model
   only finds the top row reliably. Need:
   - Per-row detection
   - Or single-row UI guidance ("crop to 1 row before scanning")

## What would actually help
- **Quick win**: Add HK-rule post-filter — reject labels that don't exist in
  HK rules (`F5..F9`, etc.). Would eliminate "F6" hallucinations on red dragons.
- **Medium**: User-correction feedback loop. After ViT returns wrong tiles, user
  clicks correct ones in UI → store corrections as new training data. Eventually
  reach 50+ per class.
- **Long-term**: Train a NEW detector+classifier from scratch on real-photo data
  only, abandoning the mahjong-souls pretraining entirely.
