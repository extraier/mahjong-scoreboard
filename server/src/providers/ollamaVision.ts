/**
 * ollamaVision.ts — local Ollama vision provider (no external API).
 *
 * Calls http(s)://<host>/api/generate with a base64-encoded image and a
 * mahjong-specific system prompt. The model is selected via config
 * (e.g. `minicpm-v`, `llama3.2-vision:11b`). Output is JSON-mode so
 * the response is reliably parseable.
 *
 * Architecture note: production traffic goes through Vercel → Tailscale
 * Funnel → this Mac mini's localhost:11434. For dev, set
 *   OLLAMA_BASE_URL=http://localhost:11434
 *   VISION_PROVIDER=ollama
 *
 * Spec §3: Ollama is a configured provider, no client redirect possible
 * (provider selection happens at boot). PDPO compliance is improved
 * because user tile photos never leave this Mac.
 */

import { config } from '../config.js';
import { ApiError } from '../errors.js';
import type { MahjongVisionResult } from '../types.js';
import type { VisionInput, VisionProvider } from './visionProvider.js';

const SYSTEM_PROMPT = `You are a mahjong hand recognition engine. You will receive
a photograph of a mahjong hand. Output ONLY valid JSON — no commentary.

TILE FORMAT (strict)
- SUIT + number, two characters
- Suits: W (萬/wan), T (筒/tong), S (索/sou), F (風/feng), H (花/flower, HK mode)
- Honors: F1=東 F2=南 F3=西 F4=北 F5=中 F6=發 F7=白
- Flowers (HK only): H1-H8

OUTPUT JSON SHEMA
{
  "tiles": ["W1","W2", ...],      // 13 or 14 tiles
  "flowers": ["H1", ...],         // empty in TW mode
  "uncertainTiles": [{"index": N, "reason": "..."}],
  "confidence": 0.85,
  "notes": ["..."]
}

Respond with ONLY that JSON object, no markdown fence.`;

async function callOllama(input: VisionInput): Promise<MahjongVisionResult> {
  const baseUrl = config.ollama.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/api/generate`;
  const b64 = Buffer.from(input.imageBytes).toString('base64');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.ollama.timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        prompt: `${SYSTEM_PROMPT}\n\nContext: gameMode=${input.gameMode}; roundWind=${input.roundWind}; seatWind=${input.seatWind}; tilesAlreadyKnown=${input.tilesAlreadyKnown ?? '(none)'}`,
        images: [b64],
        stream: false,
        format: 'json',
        // RAM hygiene: unload model from VRAM/RAM immediately after this
        // request completes. Models reload on next request (~3-10s cold).
        // OLLAMA_KEEP_ALIVE=0 (set in ~/.zshrc) is the server-side default;
        // this is the explicit per-request override that wins regardless.
        keep_alive: config.ollama.keepAlive,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError('PROVIDER_UNAVAILABLE', `ollama request failed: ${msg}`);
  }
  clearTimeout(t);

  if (!resp.ok) {
    throw new ApiError('UPSTREAM', `ollama HTTP ${resp.status}`);
  }

  let payload: unknown;
  try {
    payload = await resp.json();
  } catch {
    throw new ApiError('UPSTREAM', 'ollama response not JSON');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { response?: unknown }).response !== 'string'
  ) {
    throw new ApiError('UPSTREAM', 'ollama response missing .response field');
  }

  // Ollama returns: { response: "<json string>", eval_count: N, ... }
  const responseText = (payload as { response: string }).response.trim();
  let parsed: unknown;
  try {
    // Strip code fence if model added it
    const fenced = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsed = JSON.parse(fenced ? fenced[1].trim() : responseText);
  } catch {
    throw new ApiError('UPSTREAM', 'ollama response text not valid JSON');
  }

  return normalizeAndValidate(parsed);
}

function normalizeAndValidate(raw: unknown): MahjongVisionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new ApiError('UPSTREAM', 'model output not object');
  }
  const r = raw as Record<string, unknown>;

  const tiles = Array.isArray(r.tiles) ? r.tiles.filter(isTile) : [];
  const flowers = Array.isArray(r.flowers) ? r.flowers.filter(isFlower) : [];
  const uncertain = Array.isArray(r.uncertainTiles)
    ? (r.uncertainTiles as Array<{ index?: unknown; reason?: unknown }>)
        .filter((u) => typeof u?.index === 'number' && typeof u?.reason === 'string')
        .map((u) => ({ index: u.index as number, reason: u.reason as string }))
    : [];
  const confidence = clamp01(typeof r.confidence === 'number' ? r.confidence : 0);
  const notes = Array.isArray(r.notes)
    ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];

  return { tiles, flowers, uncertainTiles: uncertain, confidence, notes };
}

function isTile(s: unknown): s is string {
  return typeof s === 'string' && /^[WTFS][1-9]$/.test(s);
}
function isFlower(s: unknown): s is string {
  return typeof s === 'string' && /^H[1-8]$/.test(s);
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function createOllamaProvider(): VisionProvider {
  return {
    name: 'ollama',
    analyze: callOllama,
  };
}
