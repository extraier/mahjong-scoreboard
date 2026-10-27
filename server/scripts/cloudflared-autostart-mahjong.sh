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
# Hermes 2026-10-27: cloudflared --metrics port for the liveness probe.
# 2000 was free on this Mac (the DS220+ uses 2000, the UGREEN NAS uses
# 2000 + 2001).
METRICS_PORT=2000
METRICS_URL="http://127.0.0.1:${METRICS_PORT}/metrics"

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

# Two-tier health: the process exists AND it has a live connection to the
# Cloudflare edge.
#
# Hermes 2026-10-27 — this used to check "log modified in the last 5 min"
# plus "Registered tunnel connection" in the last 50 lines. Both halves
# were broken:
#   1. A HEALTHY, IDLE cloudflared writes NOTHING to its log. It only
#      logs on connect/disconnect and on requests. So the mtime check was
#      always false for a quiet tunnel.
#   2. Every restart writes ~25 "precheck ..." lines, which pushed the
#      "Registered tunnel connection" lines out of the `tail -50` window.
#
# Net effect: the launchd job (StartInterval 900 = every 15 min) killed
# and restarted a perfectly healthy tunnel every single cycle, and the
# log showed "FAILED to start" every time even while traffic was being
# served fine.
#
# THE FIX: probe cloudflared's own /metrics endpoint. The gauge
# `cloudflared_tunnel_ha_connections` is the live count of edge
# connections. 0 = genuinely down, >0 = genuinely healthy. It does not
# care when the log was last written.
cloudflared_healthy() {
  ps -ef | grep -v grep | grep -q "[c]loudflared.*tunnel run ${TUNNEL_NAME}" || return 1
  local conns
  conns=$(curl -s --max-time 5 "$METRICS_URL" 2>/dev/null \
          | grep -m1 '^cloudflared_tunnel_ha_connections ' \
          | awk '{print $2}')
  [ -n "$conns" ] && [ "$conns" -gt 0 ] 2>/dev/null || return 1
  return 0
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
nohup "$CFD" --no-autoupdate --metrics "localhost:${METRICS_PORT}" --config "$CFG" tunnel run "$TUNNEL_NAME" \
  >> "$LOG" 2>&1 < /dev/null &
CFPID=$!
disown "$CFPID" 2>/dev/null || true

# Hermes 2026-10-27: wait up to 30s for the connector to actually register
# with the CF edge (metrics gauge > 0). The old fixed `sleep 8` was not
# always enough on a cold start and produced a misleading "FAILED to start"
# even when the tunnel came up moments later.
for i in $(seq 1 15); do
  sleep 2
  if cloudflared_healthy; then
    PID=$(ps -ef | grep -v grep | grep "cloudflared.*tunnel run ${TUNNEL_NAME}" | awk '{print $2}' | head -1)
    log "Started OK (PID $PID, registered after $((i * 2))s)"
    exit 0
  fi
done
log "FAILED to start (check $LOG)"
exit 1
