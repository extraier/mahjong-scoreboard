#!/usr/bin/env bash
#
# scripts/smoke.sh — verify the local mahjong dev stack end-to-end.
#
# Checks (each prints PASS or FAIL):
#   1. Local vision server (/health → ready)
#   2. Node API server (entitlements → premium=true)
#   3. /api/vision/analyze (returns requestId + tiles)
#   4. /api/vision/correct (returns diff_count, persists to Firestore)
#   5. Firestore read (verify vision_calls doc exists)
#
# Usage:
#   ./scripts/smoke.sh                    # uses defaults (localhost:8788 + :8789)
#   API_PORT=9000 ./scripts/smoke.sh      # override ports
#   IMAGE=/path/to/photo.jpg ./scripts/smoke.sh
#
# Exits 0 if all pass, 1 otherwise. Designed for CI / "did I just break
# the dev stack?" sanity checks.

set -uo pipefail

API_PORT="${API_PORT:-8788}"
VISION_PORT="${VISION_PORT:-8789}"
API_BASE="http://127.0.0.1:${API_PORT}"
VISION_BASE="http://127.0.0.1:${VISION_PORT}"
IMAGE="${IMAGE:-}"

PASS=0
FAIL=0
FAILED_CHECKS=()

ok() {
  echo "  ✅ PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "  ❌ FAIL: $1"
  if [[ -n "${2:-}" ]]; then
    echo "         $2"
  fi
  FAIL=$((FAIL + 1))
  FAILED_CHECKS+=("$1")
}

section() {
  echo
  echo "── $1 ──"
}

# ─── 1. Local vision server ──────────────────────────────────────────────
section "1. Local vision server (port $VISION_PORT)"
HEALTH=$(curl -s --max-time 5 "${VISION_BASE}/health" 2>&1)
if echo "$HEALTH" | grep -q '"status":"ready"'; then
  DEVICE=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['device'])" 2>/dev/null || echo "?")
  ok "vision server ready on $DEVICE"
else
  fail "vision /health" "got: ${HEALTH:0:200}"
fi

# ─── 2. Node API server entitlements ─────────────────────────────────────
section "2. Node API server entitlements (port $API_PORT)"
ENT=$(curl -s --max-time 5 "${API_BASE}/api/me/entitlements" \
  -H "Authorization: Bearer test-token" 2>&1)
if echo "$ENT" | grep -q '"isPremium":true'; then
  ok "entitlements returns premium=true"
elif echo "$ENT" | grep -q '"isPremium":false'; then
  fail "entitlements returns isPremium=false" "FREE_PREMIUM_TESTING_UIDS env var not set?"
else
  fail "entitlements endpoint" "got: ${ENT:0:200}"
fi

# ─── 3. /api/vision/analyze ──────────────────────────────────────────────
section "3. /api/vision/analyze"

# If no image provided, look for one in the cache (prefer the brightest + largest
# so neither the brightness gate nor the resolution gate rejects it).
# Vision API brightness gate: MIN_AVG_BRIGHTNESS=35, MAX_AVG_BRIGHTNESS=235.
# We require 60..220 to leave a safety margin.
if [[ -z "$IMAGE" ]]; then
  CANDIDATES=$(ls -t /Users/roger/.hermes/cache/images/*.jpg /tmp/*.jpg 2>/dev/null | head -10)
  BEST=""
  BEST_SCORE=0
  for cand in $CANDIDATES; do
    INFO=$(python3 -c "
from PIL import Image
import numpy as np
img = Image.open('$cand').convert('L')
arr = np.array(img)
brightness = int(arr.mean())
w, h = img.size
# Score = brightness × area / 10000. Both must be above minimums to pass.
print(f'{brightness} {w} {h} {w*h}')
" 2>/dev/null || echo "0 0 0 0")
    BR=$(echo "$INFO" | cut -d' ' -f1)
    W=$(echo "$INFO" | cut -d' ' -f2)
    H=$(echo "$INFO" | cut -d' ' -f3)
    AREA=$(echo "$INFO" | cut -d' ' -f4)
    # Hard requirements: brightness in [60, 220] AND min(W,H) ≥ 180 (above 480×180 gate)
    if [[ "$BR" -lt 60 || "$BR" -gt 220 || $W -lt 480 || $H -lt 180 ]]; then
      continue
    fi
    SCORE=$((BR * AREA / 10000))
    if [[ "$SCORE" -gt "$BEST_SCORE" ]]; then
      BEST_SCORE=$SCORE
      BEST=$cand
    fi
  done
  if [[ -n "$BEST" ]]; then
    IMAGE=$BEST
    echo "  📷 using cached image: $IMAGE (score=$BEST_SCORE)"
  else
    # Fall back to first candidate (will likely fail gate, but gives a clear error)
    IMAGE=$(echo "$CANDIDATES" | head -1)
    echo "  ⚠️  no cached image meets brightness∈[60,220] + resolution≥480×180"
    echo "      set IMAGE=/path/to/photo.jpg explicitly; using $IMAGE"
  fi
fi

if [[ -z "$IMAGE" || ! -f "$IMAGE" ]]; then
  fail "no test image found" "set IMAGE=/path/to/photo.jpg"
else
  ANALYZE=$(curl -s --max-time 15 -X POST "${API_BASE}/api/vision/analyze" \
    -H "Authorization: Bearer test-token" \
    -F "image=@${IMAGE}" \
    -F "gameMode=hk" \
    -F "consent=true" \
    -F "roundWind=東" \
    -F "seatWind=東" 2>&1)

  REQ_ID=$(echo "$ANALYZE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('requestId',''))" 2>/dev/null || echo "")
  TILE_COUNT=$(echo "$ANALYZE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('result',{}).get('tiles',[])))" 2>/dev/null || echo "0")

  if [[ -n "$REQ_ID" ]]; then
    ok "analyze returned requestId=$REQ_ID, tiles=$TILE_COUNT"
  else
    fail "analyze returned no requestId" "got: ${ANALYZE:0:300}"
  fi
fi

# ─── 4. /api/vision/correct ──────────────────────────────────────────────
section "4. /api/vision/correct"
if [[ -n "${REQ_ID:-}" ]]; then
  # Send deliberately different corrected tiles to test diff
  CORRECT=$(curl -s --max-time 10 -X POST "${API_BASE}/api/vision/correct" \
    -H "Authorization: Bearer test-token" \
    -H "Content-Type: application/json" \
    -d "{\"request_id\":\"$REQ_ID\",\"corrected_tiles\":[\"W1\",\"W2\",\"W3\",\"W4\",\"W5\",\"W6\",\"W7\",\"W8\",\"W9\",\"W9\",\"W9\",\"W9\",\"W9\",\"W9\"],\"photo_consent\":false}" 2>&1)

  DIFF=$(echo "$CORRECT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('diff_count','?'))" 2>/dev/null || echo "?")

  if [[ "$DIFF" != "?" ]]; then
    ok "correct returned diff_count=$DIFF"
  else
    fail "correct endpoint" "got: ${CORRECT:0:300}"
  fi
else
  echo "  ⏭  SKIP (no request_id from step 3)"
fi

# ─── 5. Firestore read ───────────────────────────────────────────────────
section "5. Firestore read (vision_calls collection)"
if [[ -n "${REQ_ID:-}" ]]; then
  FS_RESULT=$(cd ~/mahjong-scoreboard/server && source .mlvenv/bin/activate 2>/dev/null && \
    python3 -c "
import json
from google.cloud import firestore
from google.oauth2 import service_account

with open('/Users/roger/.hermes/secrets/savetheday-firebase-sa.json') as f:
    sa = json.load(f)

creds = service_account.Credentials.from_service_account_info(sa)
db = firestore.Client(project='savetheday-2377a', credentials=creds)
docs = list(db.collection('vision_calls').where('request_id', '==', '${REQ_ID}').get())
print(len(docs))
" 2>&1 | tail -1)

  if [[ "$FS_RESULT" -ge 1 ]]; then
    ok "vision_calls doc found for request_id"
  elif [[ "$FS_RESULT" -eq 0 ]]; then
    fail "no vision_calls doc" "Firestore write may have failed (check server logs)"
  else
    fail "Firestore query failed" "$FS_RESULT"
  fi
else
  echo "  ⏭  SKIP (no request_id from step 3)"
fi

# ─── Summary ─────────────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed checks:"
  for c in "${FAILED_CHECKS[@]}"; do
    echo "  - $c"
  done
  exit 1
fi

exit 0
