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
# Full command line of the connector this watchdog owns (`pgrep -f` / `pkill -f`).
TUNNEL_PROC="cloudflared.*tunnel run ${TUNNEL_NAME}"
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

# Liveness is cloudflared's own /metrics gauge, not the process table.
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
# `cloudflared_tunnel_ha_connections` is the live count of edge
# connections. 0 = genuinely down, >0 = genuinely healthy. It does not
# care when the log was last written.
#
# Do not decide that with `ps -ef | grep -v grep | grep -q ...`. `grep -q`
# exits on the first match and closes the pipe, so the upstream `ps`/`grep`
# dies with SIGPIPE (exit 141). Under `set -o pipefail` that 141 is the
# pipeline status, and a running tunnel can look absent. This job then starts
# a second cloudflared, fails to bind the metrics port ("address already
# in use"), and exits 1 while the original connector is healthy. Presence
# checks use `pgrep -f` instead (`/usr/bin/pgrep`, on launchd's default
# PATH). The gauge is read only after curl has finished, so a `grep -m1`
# in that pipeline cannot SIGPIPE the scrape the same way.
cloudflared_running() {
  pgrep -f "$TUNNEL_PROC" >/dev/null 2>&1
}

cloudflared_ha_connections() {
  local body
  body=$(curl -s --max-time 5 "$METRICS_URL" 2>/dev/null) || return 1
  awk '
    $1 == "cloudflared_tunnel_ha_connections" && !seen { value = $2; seen = 1 }
    END { if (!seen) exit 1; print value }
  ' <<<"$body"
}

cloudflared_healthy() {
  local conns
  conns=$(cloudflared_ha_connections) || return 1
  [ -n "$conns" ] && [ "$conns" -gt 0 ] 2>/dev/null
}

if cloudflared_healthy; then
  log "cloudflared already healthy"
  exit 0
fi

# Zombied? Kill before restart so the new process can bind the metrics port.
if cloudflared_running; then
  log "cloudflared running but unhealthy, killing"
  pkill -f "$TUNNEL_PROC" 2>/dev/null || true
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
    PID=$(pgrep -of "$TUNNEL_PROC" 2>/dev/null || true)
    [ -n "$PID" ] || PID=$CFPID
    log "Started OK (PID $PID, registered after $((i * 2))s)"
    exit 0
  fi
done
log "FAILED to start (check $LOG)"
exit 1
