#!/usr/bin/env bash
# download_yolo.sh — fetch the nikmomo/Mahjong-YOLO yolo11n model.
#
# Used by local_vision_recognizer.py when LOCAL_VISION_DETECTOR=yolo.
# Downloads ~5.5 MB to models/mahjong-yolo/yolo11n_best.pt.
#
# Source: https://github.com/nikmomo/Mahjong-YOLO (MIT license)
# Trained on Mahjong Soul mobile photos; we use it for DETECTION ONLY —
# our v4 ViT handles CLASSIFICATION (trained on Camerash real tiles).
#
# Why we don't ship the model: 5.5 MB binary, regenerated from upstream.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../models/mahjong-yolo"
TARGET_FILE="$TARGET_DIR/yolo11n_best.pt"

mkdir -p "$TARGET_DIR"

if [ -f "$TARGET_FILE" ]; then
  echo "[download_yolo] $TARGET_FILE already exists, skipping"
  exit 0
fi

echo "[download_yolo] fetching yolo11n_best.pt (~5.5 MB)..."
curl -L --fail --show-error \
  -o "$TARGET_FILE" \
  "https://raw.githubusercontent.com/nikmomo/Mahjong-YOLO/main/trained_models_v2/yolo11n_best.pt"

echo "[download_yolo] done: $TARGET_FILE"
ls -la "$TARGET_FILE"
