# Vision providers — configuration and RAM hygiene

This server supports four vision providers. Each has different tradeoffs in
terms of accuracy, latency, RAM usage, and external network requirements.
Choose at boot via `VISION_PROVIDER=<provider>`.

## Provider comparison

| Provider | Latency (cold → warm) | RAM | Accuracy on real 麻雀 | Network | Cost |
|---|---|---|---|---|---|
| `local` (OpenCV+ViT, default recommended) | 6s → 0.5s | ~350 MB | 50-65% per-tile | None | $0 |
| `ollama` (e.g. `minicpm-v`) | 10-15s → 4s | 4-5 GB when loaded | 35-50% per-tile | None | $0 |
| `minimax` (MiniMax-M3 via api.minimax.io) | 3s → 3s | 0 (HTTP) | Higher with prompt tuning | MiniMax API | Pay per use |
| `stub` | <50ms | 0 | 100% "correct" on canned hand | None | $0 (test only) |

## Recommended defaults

- **Production on a memory-constrained machine (Mac mini M4 16GB)**: `local`
  with `OLLAMA_KEEP_ALIVE=0` so any ollama model is unloaded after each call
- **Production on a powerful machine (Mac Studio M2 Ultra 64GB+)**: `local`
  with optional `ollama` fallback for tiles the local ViT can't classify
  (low-confidence tiles)
- **Demo / hackathon**: `minimax` if the API key works, otherwise `local`
- **Tests**: `stub` (deterministic, no model loading)

## RAM hygiene — Ollama models

By default, Ollama keeps models loaded in RAM between requests (`keep_alive=5m`).
For a Mac mini with 16 GB unified memory, a 5 GB `minicpm-v` model
**permanently takes one third of total RAM**, slowing every other process.

### Recommended config

```bash
# Add to ~/.zshrc so all child processes (including this server) inherit it
export OLLAMA_KEEP_ALIVE=0     # unload immediately after each request
```

The server's `ollamaVision.ts` also sends `keep_alive` on every `/api/generate`
call, so the model unloads **after each request** rather than after 5 minutes.
Cold-load penalty: ~3-10s per request while Ollama reads the model from disk.

### Behavior matrix

| `OLLAMA_KEEP_ALIVE` | First request | Subsequent requests | RAM when idle |
|---|---|---|---|
| `0` (default) | cold (~10s) | cold (~10s) | only daemon (~40MB) |
| `60` | cold (~10s) | warm (~4s) for 1 min | full model (~5GB) |
| `-1` | cold (~10s) | warm (~4s) indefinitely | full model (~5GB) |

### Uninstalling models you don't use

```bash
# List installed models (disk usage)
ollama list

# Remove a model to free disk + accelerate cold-load
ollama rm minicpm-v
ollama rm llama3.1:8b
ollama rm gemma3:4b
```

The Mac mini lost ~9 GB by removing unused vision models (most are
incompatible with Ollama 0.34 anyway — see below).

## Quantization — smaller Ollama models

Ollama's quantization level (`Q4_K_M`, `Q5_K_M`, `Q8_0`) controls the
precision of model weights and directly affects accuracy vs RAM/disk.

| Quantization | RAM | Disk (approx) | Quality loss |
|---|---|---|---|
| `Q2_K` | 1.5x smaller | 1.5x smaller | noticeable — tiles blur |
| `Q4_K_M` (default for most models) | 4x smaller than FP16 | 4x smaller | acceptable |
| `Q5_K_M` | 3x smaller | 3x smaller | minimal |
| `Q8_0` | 2x smaller | 2x smaller | nearly lossless |
| FP16 (full precision) | baseline | baseline | reference |

For mahjong tile recognition, **`Q4_K_M` is the sweet spot** — at this level
the model can still distinguish 萬 from 筒 and similar-looking honors.

### Pull a quantized variant

Ollama automatically picks the smallest available quantization if you don't
specify one. To force a specific level, use the tag:

```bash
ollama pull minicpm-v:q4_0      # 4-bit, smallest
ollama pull minicpm-v:q5_K_M    # 5-bit, balance of speed + accuracy
```

Currently installed:
```bash
$ ollama list
NAME             ID    SIZE      MODIFIED
```

To switch models:
```bash
OLLAMA_MODEL=minicpm-v:q4_0 npm run dev
```

### Models tested for mahjong (2026-09-19)

| Model | Ollama support | Mahjong accuracy | RAM | Notes |
|---|---|---|---|---|
| `minicpm-v` (default) | ✓ | 35-50% per-tile | 5 GB | Hallucinates tiles on full hand |
| `llava-1.5-7b-q4_0` | ✓ | not tested | 4 GB | Generic vision model |
| `moondream2` (1.8B) | ✓ | not tested | 1 GB | Lightest viable vision model |
| `llama3.2-vision:11b` | **DELETED in Ollama 0.34** | n/a | n/a | Architecture `mllama` removed |
| `qwen3-vl:8b` | ✓ | tested | 6 GB | 235s latency, hallucinated count |
| `gemma3:4b` | ✓ | tested | 3 GB | Hallucinated badly — text-only bias |

## Ollama version compatibility note

**Ollama 0.34 (Sep 2026) removed `mllama` architecture support**, breaking
`llama3.2-vision`. If upgrading Ollama, also re-pull these models:

```bash
ollama rm llama3.2-vision:11b
# Newer variants (qwen3-vl, gemma3) work but require more aggressive
# prompting for structured mahjong output.
```

## Local provider (OpenCV + ViT) — RAM profile

The `local` provider uses `pjura/mahjong_vision` (ViT-base-patch16-224).
There are **two modes** with different RAM / latency profiles:

### Mode 1: HTTP (default) — long-lived FastAPI server

The Python ViT model runs in a **dedicated FastAPI process**. Model loads
once at startup and stays in RAM. Subsequent requests share the model.

| State | RSS | Latency | Pattern |
|---|---|---|---|
| Cold start | 167 MB | 349 ms first req | model load 595 ms + classify 250 ms |
| Warm (subsequent) | 167 MB | **262 ms** | no model load |

Cost: ~340 MB persistent RAM. Worth it for any production traffic.

```bash
# Start the long-lived server
./scripts/start-local-vision.sh
# or directly:
./.mlvenv/bin/python scripts/local_vision_server.py --port 8789

# Node side automatically uses HTTP (default LOCAL_VISION_MODE=http)
VISION_PROVIDER=local npm run dev
```

### Mode 2: spawn (fallback) — tsx forks Python per request

Spawns `python scripts/mahjong_local_inference.py` for each request.
**Model reloads each call**, paying 6 s cold-load penalty on M4.

Use only for dev/single-request scenarios where the persistent 340 MB isn't worth it.

```bash
LOCAL_VISION_MODE=spawn VISION_PROVIDER=local npm run dev
```

### Mode 1 stack

```
┌─────────────┐         ┌─────────────┐         ┌──────────────┐
│ Vercel      │  HTTPS  │ Node (tsx)  │  HTTP   │ FastAPI      │
│ (Capacitor) │ ──────> │ localVision │ ──────> │ 8789 analyze │
│ client      │         │ provider    │         │ + ViT in RAM │
└─────────────┘         └─────────────┘         └──────────────┘
```

Total resident RAM: ~150 MB (Node) + 167 MB (Python+ViT) = **~320 MB**.
Ollama daemon: NOT loaded. Total idle footprint: **~320 MB**.

### Operational notes

- **Always pre-start the FastAPI server before `npm run dev`** in production.
  Otherwise the first request takes ~6 s while Python cold-starts.
- **`start-local-vision.sh`** uses `nohup` + PID file, so it survives the
  parent shell. Run via `kill $(cat /tmp/local_vision.pid)` to stop.
- **For multi-worker scaling**: increase uvicorn `--workers N`. Each worker
  loads its own 167 MB model — for Mac mini 16 GB, workers=2 is the ceiling.
- **`/health` endpoint** reports `device`, `min_conf`, `num_classes`. Use
  for orchestration: wait for `status:"ready"` before sending traffic.
- **`/analyze_json`** accepts `{ image_b64 }` for callers that prefer
  JSON over multipart (e.g., some Vercel edge runtimes).

### launchd — auto-start at boot

Production setup uses a macOS LaunchAgent so the FastAPI server boots
automatically when the user logs in (or at system start on managed Macs).

```bash
# install once
cp ~/mahjong-scoreboard/server/com.comparetiger.local-vision.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.comparetiger.local-vision.plist

# check status
launchctl list | grep local-vision
curl http://127.0.0.1:8789/health

# stop / disable
launchctl bootout gui/$(id -u)/com.comparetiger.local-vision
```

Key plist settings:
- `RunAtLoad = true` — auto-start after `launchctl bootstrap`
- `KeepAlive + ThrottleInterval=10` — restart on crash (with back-off)
- `ProcessType = Interactive` — disables App Nap so MPS (Metal) keeps warm
- `SoftResourceLimits.ResidentSetSize = 2 GB` — caps memory blast-radius
- `PYTHONUNBUFFERED=1` + `VIRTUAL_ENV=.mlvenv` — ensures correct interpreter + flushes logs

Logs land at `/tmp/local_vision.launchd.log` (stdout) and
`/tmp/local_vision.launchd.err` (stderr).

Note: when invoked *through* the Hermes gateway, `launchctl bootstrap`
is blocked by the smart-approval policy (registers a persistent service).
Bootstrap from a regular shell, or via this Hermes skill's external action.

## Provider switch cost

| From | To | Cost |
|---|---|---|
| `local` → `ollama` | ~10s cold + 200 MB swap | <1 min |
| `ollama` → `local` | <1s | instant |
| `local` → `minimax` | 1-3s HTTP | low |
| `minimax` → `local` | 6s cold | <1 min |

## See also

- `scripts/mahjong_local_inference.py` — the local pipeline (OpenCV+ViT)
- `scripts/finetune_mahjong_vit.py` — domain adaptation from krmin model
- `models/mahjong-vision-krmin/` — base model (331 MB, 99.6% on Mahjong Soul graphics)
- `models/mahjong-vision-finetuned/` — fine-tuned on 33 real tiles + 1054 souls tiles
