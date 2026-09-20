/**
 * visionClient — proxy mahjong-tile photo to the backend for AI
 * identification.
 *
 * Per spec §6 (POST /api/vision/analyze):
 *   - multipart/form-data with image + gameMode + roundWind + seatWind
 *   - 403 AI_PREMIUM_REQUIRED if user is not premium
 *   - 429 AI_QUOTA_EXCEEDED if monthly quota is exhausted
 *   - 413 IMAGE_TOO_LARGE / 415 UNSUPPORTED_IMAGE for bad files
 *   - 200 returns { requestId, provider, result: MahjongVisionResult, usage }
 *
 * The client NEVER holds the MiniMax API key. It only sends the image
 * to the user's own backend, which proxies to MiniMax server-side.
 */

import { request } from './apiClient';
import type {
  ApiError,
  MahjongVisionResult,
  VisionAnalyzeRequest,
  VisionAnalyzeResponse,
  VisionCorrectRequest,
  VisionCorrectResponse,
} from '../types/api';

export async function analyzeMahjongImage(
  req: VisionAnalyzeRequest
): Promise<VisionAnalyzeResponse> {
  const form = new FormData();
  form.append('image', req.image, (req.image as File).name || 'tiles.jpg');
  form.append('gameMode', req.gameMode);
  form.append('roundWind', req.roundWind);
  form.append('seatWind', req.seatWind);

  const r = await request<VisionAnalyzeResponse>('/api/vision/analyze', {
    method: 'POST',
    formData: form,
    // AI inference can take 20-30s; give it room
    timeoutMs: 60_000,
  });
  if (r.ok === true) return (r as { ok: true; data: VisionAnalyzeResponse }).data;
  const error = (r as { ok: false; error: ApiError }).error;
  throw error;
}

/**
 * Submit the player's correction to a previous AI prediction.
 *
 * Used by the "report wrong tile" button on the result review screen.
 * Premium-only — free users hit 403 AI_PREMIUM_REQUIRED.
 *
 * Fire-and-forget at the call site: callers should not block the player's
 * flow on this. The server-side write is also fire-and-forget to Firestore
 * after validating the request body.
 */
export async function correctMahjongVision(
  req: VisionCorrectRequest
): Promise<VisionCorrectResponse> {
  const r = await request<VisionCorrectResponse>('/api/vision/correct', {
    method: 'POST',
    body: req,
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.ok === true) return (r as { ok: true; data: VisionCorrectResponse }).data;
  const error = (r as { ok: false; error: ApiError }).error;
  throw error;
}

/** Empty/zero result, useful as a stub before the backend is wired */
export const EMPTY_VISION_RESULT: MahjongVisionResult = {
  tiles: [],
  flowers: [],
  uncertainTiles: [],
  confidence: 0,
  notes: [],
};
