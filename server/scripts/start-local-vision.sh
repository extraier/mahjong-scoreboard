#!/usr/bin/env bash
# start-local-vision.sh — start the FastAPI long-lived local vision server.
#
# Usage:
#   ./scripts/start-local-vision.sh                    # uses defaults
#   PORT=8790 ./scripts/start-local-vision.sh          # custom port
#   AUTO_SHUTDOWN=300 ./scripts/start-local-vision.sh  # exit after 5 min idle (dev)
#
# The server loads ViT into RAM (167 MB RSS on M4) and stays resident.
# Once running, Node's localVision provider talks to it via HTTP —
# warm latency 250-350ms vs 6s for cold spawn.
#
# For production, run via launchd (~/Library/LaunchAgents/local.vision.plist)
# so the server auto-starts at boot and restarts on crash.

set -euo pipefail
HERE="$(cd "$(dirname "$0")"/.. && pwd)"
cd "$HERE"

PYTHON_BIN="${PYTHON_BIN:-$HERE/.mlvenv/bin/python}"
PORT="${PORT:-8789}"
HOST="${HOST:-127.0.0.1}"
LOG="${LOG:-/tmp/local_vision.log}"
PID_FILE="${PID_FILE:-/tmp/local_vision.pid}"

# Stop existing
if [[ -f "$PID_FILE" ]]; then
  OLD="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD" ]] && kill -0 "$OLD" 2>/dev/null; then
    echo "stopping existing local_vision pid=$OLD"
    kill "$OLD" || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi
pkill -f "local_vision_server.py" 2>/dev/null || true
sleep 1

echo "starting local_vision_server on $HOST:$PORT"
nohup "$PYTHON_BIN" scripts/local_vision_server.py --host "$HOST" --port "$PORT" > "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

# Wait for /health (max 30s for cold-load)
for i in $(seq 1 30); do
  if curl -s --max-time 1 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
    echo "ready in ${i}s"
    curl -s "http://$HOST:$PORT/health"
    exit 0
  fi
  sleep 1
done

echo "ERROR: server did not become ready within 30s" >&2
echo "--- log tail ---" >&2
tail -30 "$LOG" >&2
exit 1
