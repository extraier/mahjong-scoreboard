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
import type { MahjongVisionResult } from '../types.js';
import type { VisionInput, VisionProvider } from './visionProvider.js';

const PYTHON_BIN = process.env.LOCAL_VISION_PYTHON ?? '.mlvenv/bin/python';
const SCRIPT_PATH = 'scripts/mahjong_local_inference.py';
const HTTP_URL = process.env.LOCAL_VISION_HTTP_URL ?? 'http://127.0.0.1:8789';
const USE_HTTP = (process.env.LOCAL_VISION_MODE ?? 'http') !== 'spawn';

interface LocalVisionResponse {
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
  return normalizeToResult(payload, 'http');
}

function normalizeToResult(p: LocalVisionResponse, mode: 'http' | 'spawn'): MahjongVisionResult {
  const tiles = Array.isArray(p.tiles) ? p.tiles.filter(isTile) : [];
  const confList = Array.isArray(p.confidences) ? p.confidences : [];
  const avg = typeof p.avg_confidence === 'number' ? p.avg_confidence : 0;
  const minConf = confList.length ? Math.min(...confList) : 0;
  const uncertainTiles = confList
    .map((c, idx) => ({ idx, conf: c }))
    .filter(({ conf }) => conf < 0.5)
    .map(({ idx, conf }) => ({
      index: idx,
      reason: `low confidence (${conf.toFixed(2)})`,
    }));
  return {
    tiles,
    flowers: [],
    uncertainTiles,
    confidence: Math.max(0, Math.min(1, avg)),
    notes: [
      `local-vision (${mode}): ${tiles.length} tiles, min conf ${minConf.toFixed(2)}, ${p.box_count ?? tiles.length} boxes scanned`,
      tiles.length < 13 ? 'fewer than 13 tiles detected — photo may be cropped or tiles too close together' : '',
    ].filter(Boolean),
  };
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
    const avg = typeof parsed.avg_confidence === 'number' ? parsed.avg_confidence : 0;
    const minConf = confList.length ? Math.min(...confList) : 0;
    const uncertainTiles = confList
      .map((c, idx) => ({ idx, conf: c }))
      .filter(({ conf }) => conf < 0.5)
      .map(({ idx, conf }) => ({ index: idx, reason: `low confidence (${conf.toFixed(2)})` }));
    return {
      tiles,
      flowers: [],
      uncertainTiles,
      confidence: Math.max(0, Math.min(1, avg)),
      notes: [
        `local-vision (spawn): ${tiles.length} tiles, min conf ${minConf.toFixed(2)}`,
        tiles.length < 13 ? 'fewer than 13 tiles detected — photo may be cropped or tiles too close together' : '',
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
