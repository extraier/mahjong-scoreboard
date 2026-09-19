/**
 * localVision.ts — Vision Transformer + OpenCV local tile recognizer.
 *
 * Pipeline:
 *   If LOCAL_VISION_MODE=http (default): POSTs image bytes to
 *     local_vision_server.py (FastAPI) at LOCAL_VISION_HTTP_URL. Model is
 *     already loaded in RAM in that long-lived process (no cold-load),
 *     giving ~250ms warm latency vs 6s for cold spawn.
 *   If LOCAL_VISION_MODE=spawn: spawns mahjong_local_inference.py per
 *     request (6s cold-load on M4). Used as fallback if HTTP server is
 *     unreachable.
 *
 * Both modes use:
 *   - OpenCV (Canny + findContours) for tile region detection
 *   - pjura/mahjong_vision (HuggingFace) ViT for tile classification
 *
 * Both run locally on this Mac mini — no external API call. Privacy & cost
 * both zero. Warm latency 240-350ms via HTTP, ~3-6s spawn.
 *
 * Spec §3: selected at boot via VISION_PROVIDER=local. No client redirect.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import {
  filterByConfidence,
  filterInvalidTiles,
} from '../services/tileFilter.js';
import type { MahjongVisionResult } from '../types.js';
import type { VisionInput, VisionProvider } from './visionProvider.js';

const PYTHON_BIN = process.env.LOCAL_VISION_PYTHON ?? '.mlvenv/bin/python';
const SCRIPT_PATH = 'scripts/mahjong_local_inference.py';
const HTTP_URL = process.env.LOCAL_VISION_HTTP_URL ?? 'http://127.0.0.1:8789';
const USE_HTTP = (process.env.LOCAL_VISION_MODE ?? 'http') !== 'spawn';

interface LocalVisionResponse {
  width?: number;
  height?: number;
  original_width?: number;
  original_height?: number;
  upscale_applied?: boolean;
  upscale_note?: string | null;
  tile_count: number;
  tiles: string[];
  confidences: number[];
  avg_confidence: number;
  box_count: number;
  boxes: number[][];
  rejected?: Array<{ index: number; bbox: number[]; conf: number }>;
  elapsed_detect_ms: number;
  elapsed_classify_ms: number;
}

async function callHttp(
  input: VisionInput,
  timeoutMs: number,
): Promise<MahjongVisionResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(input.imageBytes)], { type: input.imageMime }),
      'hand.jpg',
    );
    resp = await fetch(`${HTTP_URL}/analyze`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError('PROVIDER_UNAVAILABLE', `local-vision HTTP failed (${HTTP_URL}): ${msg}`);
  }
  clearTimeout(t);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ApiError('UPSTREAM', `local-vision HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  let payload: LocalVisionResponse;
  try {
    payload = (await resp.json()) as LocalVisionResponse;
  } catch (e) {
    throw new ApiError('UPSTREAM', `local-vision response not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return normalizeToResult(payload, 'http', input.gameMode);
}

function normalizeToResult(
  p: LocalVisionResponse,
  mode: 'http' | 'spawn',
  gameMode: 'HK' | 'TW' = 'HK',
): MahjongVisionResult {
  // Step 1: drop tiles that don't exist in HK/TW rules (e.g. F8/F9 hallucinations)
  const rawTiles = Array.isArray(p.tiles) ? p.tiles.filter(isTile) : [];
  const confList = Array.isArray(p.confidences) ? p.confidences : [];

  // Step 2: apply adaptive confidence threshold based on ORIGINAL image
  // dimensions (not the upscaled ones used for detection). For tiny photos
  // (< 200px tall or < 600px wide), the classifier tops out at ~0.23
  // conf — drop the threshold to 0.2 to recover them.
  const width = p.original_width ?? p.width ?? 1200;
  const height = p.original_height ?? p.height ?? 200;
  const acceptedIdx = filterByConfidence(confList, width, height);

  // Step 4: detect multi-row compositions and emit a hint in notes so the
  // UI can prompt the user to crop. A 14-tile hand is one row; if we
  // detect many more boxes than that, it's probably multi-row.
  const isLikelyMultiRow = (p.box_count ?? 0) > 16;

  // Map accepted indices to tiles + confidences; if a tile was rejected
  // by confidence, exclude both tile and confidence to keep them aligned.
  const acceptedTiles = acceptedIdx.map((i) => rawTiles[i]).filter((t): t is string => Boolean(t));
  const acceptedConfs = acceptedIdx.map((i) => confList[i]);

  // Step 3: enforce HK rule caps (max 4 copies of any single tile)
  const filteredTiles = filterInvalidTiles(acceptedTiles, gameMode);

  const minConf = acceptedConfs.length ? Math.min(...acceptedConfs) : 0;
  const avg = acceptedConfs.length
    ? acceptedConfs.reduce((s, c) => s + c, 0) / acceptedConfs.length
    : 0;

  // Build uncertainTiles list for the UI from BOTH the rejected-from-confidence
  // AND the rule-filtered tiles so users can correct them in the app.
  const filteredSet = new Set(filteredTiles);
  const uncertainTiles: Array<{ index: number; reason: string }> = [];
  acceptedTiles.forEach((t, i) => {
    if (!filteredSet.has(t)) {
      // filtered out by rule (over-cap 4 copies or invalid label)
      uncertainTiles.push({ index: i, reason: `rejected by HK rule filter (${t})` });
    }
  });

  const upscaleNote = p.upscale_applied && p.upscale_note ? p.upscale_note : '';

  return {
    tiles: filteredTiles,
    flowers: [],
    uncertainTiles,
    confidence: Math.max(0, Math.min(1, avg)),
    notes: [
      `local-vision (${mode}): ${filteredTiles.length} tiles accepted, min conf ${minConf.toFixed(2)}, ${p.box_count ?? filteredTiles.length} boxes scanned, threshold ${adaptiveThresholdFor(width, height)}`,
      upscaleNote,
      isLikelyMultiRow
        ? `multi-row composition detected (${p.box_count} boxes found) — for best results, crop to a single row before scanning`
        : '',
      filteredTiles.length < 13 ? 'fewer than 13 tiles detected — photo may be cropped or tiles too close together' : '',
    ].filter(Boolean),
  };
}

function adaptiveThresholdFor(w: number, h: number): string {
  // Mirrors tileFilter.adaptiveMinConfidence for note formatting only
  if (h < 80 || w < 400) return '0.2 (very-low-res)';
  return '0.4 (default)';
}

async function runPython(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        reject(new Error(`local-vision timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(t);
        reject(e);
      }
    });
    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
  });
}

async function callSpawn(input: VisionInput): Promise<MahjongVisionResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'mahjong-'));
  const ext = input.imageMime === 'image/png' ? 'png' : input.imageMime === 'image/gif' ? 'gif' : 'jpg';
  const imgPath = join(tmpDir, `hand.${ext}`);
  await writeFile(imgPath, Buffer.from(input.imageBytes));

  try {
    const { stdout, stderr, code } = await runPython([SCRIPT_PATH, imgPath, '--json'], config.localVision.timeoutMs);
    if (code !== 0) {
      throw new ApiError('PROVIDER_UNAVAILABLE', `local-vision exited ${code}: ${stderr.slice(0, 200)}`);
    }
    let parsed: { tiles?: unknown; confidences?: unknown; avg_confidence?: unknown; box_count?: number };
    try {
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('no JSON object in stdout');
      parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError('UPSTREAM', `local-vision output unparseable: ${msg}`);
    }
    const tiles = Array.isArray(parsed.tiles) ? (parsed.tiles as string[]).filter(isTile) : [];
    const confList = Array.isArray(parsed.confidences) ? (parsed.confidences as number[]) : [];

    // Spawn mode doesn't know image dimensions; assume default-res.
    const acceptedIdx = filterByConfidence(confList, 1200, 200);
    const acceptedTiles = acceptedIdx.map((i) => tiles[i]).filter((t): t is string => Boolean(t));
    const acceptedConfs = acceptedIdx.map((i) => confList[i]);
    const filteredTiles = filterInvalidTiles(acceptedTiles, input.gameMode);
    const minConf = acceptedConfs.length ? Math.min(...acceptedConfs) : 0;
    const avg = acceptedConfs.length
      ? acceptedConfs.reduce((s, c) => s + c, 0) / acceptedConfs.length
      : 0;
    const filteredSet = new Set(filteredTiles);
    const uncertainTiles: Array<{ index: number; reason: string }> = [];
    acceptedTiles.forEach((t, i) => {
      if (!filteredSet.has(t)) {
        uncertainTiles.push({ index: i, reason: `rejected by HK rule filter (${t})` });
      }
    });
    return {
      tiles: filteredTiles,
      flowers: [],
      uncertainTiles,
      confidence: Math.max(0, Math.min(1, avg)),
      notes: [
        `local-vision (spawn): ${filteredTiles.length} tiles, min conf ${minConf.toFixed(2)}`,
        filteredTiles.length < 13 ? 'fewer than 13 tiles detected — photo may be cropped or tiles too close together' : '',
      ].filter(Boolean),
    };
  } finally {
    unlink(imgPath).catch(() => {});
  }
}

async function callLocal(input: VisionInput): Promise<MahjongVisionResult> {
  if (USE_HTTP) {
    try {
      return await callHttp(input, config.localVision.timeoutMs);
    } catch (e) {
      // Fallback to spawn if FastAPI server not reachable (e.g. dev without it)
      if (e instanceof ApiError && e.code === 'PROVIDER_UNAVAILABLE') {
        return await callSpawn(input);
      }
      throw e;
    }
  }
  return await callSpawn(input);
}

function isTile(s: unknown): s is string {
  return typeof s === 'string' && /^[WTFS][1-9]$/.test(s);
}
function isFlower(s: unknown): s is string {
  return typeof s === 'string' && /^H[1-8]$/.test(s);
}

export function createLocalVisionProvider(): VisionProvider {
  return {
    name: 'local',
    analyze: callLocal,
  };
}
