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
RAM profile at runtime:

| State | RSS | VRAM (MPS) |
|---|---|---|
| Cold (first request) | 200 MB | loads 331 MB model into MPS |
| Warm (subsequent) | 350 MB | 331 MB model resident |
| After 5 min idle (model not unloaded) | 350 MB | 331 MB |

The script `scripts/mahjong_local_inference.py` **keeps the model in memory
between calls within one process**. Each `tsx spawn python` invocation pays
the cold-load cost (~6s on M4), so for high-frequency use, **run the Python
side as a long-lived service** (`scripts/local_vision_server.py` mode).

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
