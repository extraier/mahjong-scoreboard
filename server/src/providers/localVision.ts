/**
 * localVision.ts — Vision Transformer + OpenCV local tile recognizer.
 *
 * Pipeline:
 *   1. Save uploaded image to /tmp
 *   2. Spawn Python script (scripts/mahjong_local_inference.py) — that
 *      script handles tile detection + ViT classification end-to-end
 *   3. Parse JSON output
 *   4. Map to MahjongVisionResult
 *
 * The Python side uses:
 *   - OpenCV (Canny + findContours) for tile region detection
 *   - pjura/mahjong_soul_vision (HuggingFace) ViT for tile classification
 *
 * Both run locally on this Mac mini — no external API call. Privacy & cost
 * both zero. 26ms/tile warm, ~340ms for full 13-tile hand on M4 MPS.
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
        clearTimeout(t);
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
  });
}

async function callLocal(input: VisionInput): Promise<MahjongVisionResult> {
  // Save image to a temp file
  const tmpDir = await mkdtemp(join(tmpdir(), 'mahjong-'));
  const ext = input.imageMime === 'image/png' ? 'png' : input.imageMime === 'image/gif' ? 'gif' : 'jpg';
  const imgPath = join(tmpDir, `hand.${ext}`);
  await writeFile(imgPath, Buffer.from(input.imageBytes));

  try {
    const { stdout, stderr, code } = await runPython([SCRIPT_PATH, imgPath, '--json'], config.localVision.timeoutMs);

    if (code !== 0) {
      throw new ApiError('PROVIDER_UNAVAILABLE', `local-vision exited ${code}: ${stderr.slice(0, 200)}`);
    }

    let parsed: { tiles?: unknown; confidences?: unknown; avg_confidence?: unknown };
    try {
      // Output may contain non-JSON noise before/after — pick the JSON object
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
        `local-vision: ${tiles.length} tiles, min conf ${minConf.toFixed(2)}`,
        tiles.length < 13 ? 'fewer than 13 tiles detected — photo may be cropped or tiles too close together' : '',
      ].filter(Boolean),
    };
  } finally {
    // Best-effort cleanup
    unlink(imgPath).catch(() => {});
  }
}

function isTile(s: unknown): s is string {
  return typeof s === 'string' && /^[WTFS][1-9]$/.test(s);
}

export function createLocalVisionProvider(): VisionProvider {
  return {
    name: 'local',
    analyze: callLocal,
  };
}
