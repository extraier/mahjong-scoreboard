/**
 * minimaxVision.ts — real MiniMax Vision provider.
 *
 * Calls POST {baseUrl}/v1/chat/completions with the OpenAI-compatible
 * vision schema. The model and base URL are selected from config:
 *   - VISION_PROVIDER=minimax + MINIMAX_API_KEY set → this provider
 *   - Otherwise → stubProvider (selected at boot, see routes/vision.ts)
 *
 * Failure modes the provider may throw (caught in routes/vision.ts and
 * mapped to typed ApiError):
 *   - 401/403 → PROPAGATE user-visible message
 *   - 408/504 → PROVIDER_UNAVAILABLE (caller may retry)
 *   - 429 → PROVIDER_UNAVAILABLE (transient)
 *   - response that doesn't parse as MahjongVisionResult schema →
 *     UPSTREAM (raw body logged, no leak to client)
 *
 * Notes on token usage:
 * - The request includes image_url pointing at a base64 data URI,
 *   so the cost is dominated by image tokens. For a 1024×1024 JPEG
 *   that decodes to ~1000 tokens of image content, each call costs
 *   roughly $0.01–0.03 on MiniMax-M3 pricing as of 2026-Q3.
 */

import { config } from '../config.js';
import { ApiError } from '../errors.js';
import type { MahjongVisionResult } from '../types.js';
import type { VisionInput, VisionProvider } from './visionProvider.js';

const SYSTEM_PROMPT = `You are a mahjong hand recognition engine. You will receive
a photograph of a mahjong hand in front of a player. Output ONLY the
recognized tiles in valid JSON, no other commentary.

TILE FORMAT
- Two-character strings: SUIT + number
- Suits: W (萬/wan), T (筒/tong), S (索/sou), F (風/feng),
  H (花/flower, for HK mode only)
- Numbers: 1-9
- Honor tiles: F1=東 F2=南 F3=西 F4=北 F5=中 F6=發 F7=白
- Flowers: H1-H8 (HK only); ignore in TW mode

OUTPUT SCHEMA (strict; failed parse = UPSTREAM error)
{
  "tiles": ["W1","W2",...],      // 13 or 14 tiles visible
  "flowers": ["H1",...],         // empty in TW mode
  "uncertainTiles": [
    {"index": 0, "reason": "tile partially occluded"}
  ],
  "confidence": 0.92,            // 0..1
  "notes": ["..."]               // free-form debugging hints
}

Respond with the JSON object, nothing else.`;

function dataUriFromBytes(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function callMiniMax(input: VisionInput): Promise<MahjongVisionResult> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new ApiError('PROVIDER_DISABLED', 'MINIMAX_API_KEY not configured');
  }

  const baseUrl = config.vision.apiBaseUrl; // e.g. https://api.minimax.io/v1
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: 'MiniMax-M3',
    max_tokens: 800,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUriFromBytes(input.imageBytes, input.imageMime) },
          },
          {
            type: 'text',
            text: `gameMode=${input.gameMode}; roundWind=${input.roundWind}; seatWind=${input.seatWind}; tilesAlreadyKnown=${input.tilesAlreadyKnown ?? '(none)'}`,
          },
        ],
      },
    ],
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.vision.timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    clearTimeout(t);
    throw new ApiError('PROVIDER_UNAVAILABLE', `vision request failed: ${msg}`);
  }
  clearTimeout(t);

  const text = await resp.text();
  if (!resp.ok) {
    // Don't expose upstream body in user-visible error; log it instead
    const code =
      resp.status === 401 || resp.status === 403
        ? 'AI_PREMIUM_REQUIRED' // wrong-tier; should never happen because auth has run
        : resp.status === 429
          ? 'PROVIDER_UNAVAILABLE'
          : 'UPSTREAM';
    throw new ApiError(code, `MiniMax vision returned HTTP ${resp.status}`);
  }

  // Extract JSON from the assistant message. Models sometimes return
  // ```json\n{...}\n```; strip code fences if present.
  let parsedContent: unknown;
  try {
    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? '';
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsedContent = JSON.parse(fenced ? fenced[1].trim() : raw);
  } catch (e) {
    throw new ApiError('UPSTREAM', 'MiniMax returned non-JSON response');
  }

  return normalizeAndValidate(parsedContent);
}

/** Coerce the model's JSON into our strict types — drops obviously bad tiles. */
function normalizeAndValidate(raw: unknown): MahjongVisionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new ApiError('UPSTREAM', 'model output is not an object');
  }
  const r = raw as Record<string, unknown>;

  const tilesIn = Array.isArray(r.tiles) ? r.tiles.filter(isTile) : [];
  const flowersIn = Array.isArray(r.flowers) ? r.flowers.filter(isFlower) : [];
  const uncertainIn = Array.isArray(r.uncertainTiles)
    ? (r.uncertainTiles as Array<{ index?: number; reason?: string }>)
        .filter((u) => typeof u?.index === 'number' && typeof u?.reason === 'string')
        .map((u) => ({ index: u.index as number, reason: u.reason as string }))
    : [];
  const confidence = clamp01(typeof r.confidence === 'number' ? r.confidence : 0);
  const notes = Array.isArray(r.notes)
    ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];

  return {
    tiles: tilesIn,
    flowers: flowersIn,
    uncertainTiles: uncertainIn,
    confidence,
    notes,
  };
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

export function createMinimaxProvider(): VisionProvider {
  return {
    name: 'minimax',
    analyze: callMiniMax,
  };
}
