#!/usr/bin/env bash
# cloudflared-autostart-mahjong.sh — start the Cloudflare Tunnel that
# exposes the Mac mini's local vision server (ViT) to the internet.
#
# Why: the mahjong backend on Vercel cannot reach 127.0.0.1 on this Mac.
# The tunnel gives it https://vision.comparetiger.com → 127.0.0.1:8789.
#
# The origin is protected by the shared secret in LOCAL_VISION_TOKEN —
# the tunnel's public URL alone is not access.

set -uo pipefail

TUNNEL_NAME="mahjong-local-vision"
CFG="$HOME/.cloudflared/config.yml"
LOG="$HOME/.cloudflared/mahjong-local-vision.log"
CFD="/opt/homebrew/bin/cloudflared"
LOCK="$HOME/.cloudflared/.mahjong-watchdog.lock"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# macOS has no `flock` (that is a Linux/Synology thing). Use mkdir as an
# atomic lock instead: mkdir fails if the directory already exists.
LOCK_DIR="${LOCK%.lock}.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Stale lock from a crashed run? Clear it if it is older than 10 min.
  if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -mmin +10 2>/dev/null)" ]; then
    log "clearing stale lock"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || { log "lock race, exiting"; exit 0; }
  else
    log "another watchdog run is in progress, exiting"
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

# Two-tier health: the process exists AND the log shows a recent
# registered tunnel connection. A zombied cloudflared has a PID but no
# live connection.
cloudflared_healthy() {
  ps -ef | grep -v grep | grep -q "[c]loudflared.*tunnel run ${TUNNEL_NAME}" || return 1
  if [ -f "$LOG" ] && [ -n "$(find "$LOG" -mmin -5 2>/dev/null)" ]; then
    tail -50 "$LOG" | grep -q "Registered tunnel connection" && return 0
  fi
  return 1
}

if cloudflared_healthy; then
  log "cloudflared already healthy"
  exit 0
fi

# Zombied? Kill before restart.
if ps -ef | grep -v grep | grep -q "[c]loudflared.*tunnel run ${TUNNEL_NAME}"; then
  log "cloudflared running but unhealthy, killing"
  pkill -f "cloudflared.*tunnel run ${TUNNEL_NAME}" 2>/dev/null
  sleep 3
fi

log "Starting cloudflared tunnel run ${TUNNEL_NAME}"
# NOTE: the `tunnel` subcommand + name is REQUIRED. `cloudflared --config X run`
# prints help and exits 0, which looks like a config bug but is silently nothing.
#
# macOS has no `setsid`. `nohup ... &` plus `disown` is the equivalent
# detach; the launchd watchdog is the real supervisor, so a mildly
# attached child is acceptable here.
nohup "$CFD" --no-autoupdate --config "$CFG" tunnel run "$TUNNEL_NAME" \
  >> "$LOG" 2>&1 < /dev/null &
CFPID=$!
disown "$CFPID" 2>/dev/null || true

sleep 8
if cloudflared_healthy; then
  PID=$(ps -ef | grep -v grep | grep "[c]loudflared.*tunnel run ${TUNNEL_NAME}" | awk '{print $2}' | head -1)
  log "Started OK (PID $PID)"
else
  log "FAILED to start (check $LOG)"
fi
