/**
 * routes/vision.ts — POST /api/vision/analyze
 *
 * Five-step handler. Each step explicitly fails closed:
 *
 *   1. requireAuth (router-level middleware) → 401 if no Bearer
 *   2. Entitlement check (services/entitlements.computeEntitlements) →
 *      403 AI_PREMIUM_REQUIRED if !canUseAi. Spec §8.
 *   3. Quota check (services/usage.remaining) → 429 QUOTA_EXCEEDED.
 *   4. Image pipeline (services/imagePipeline.normalizeUpload) →
 *      400 INVALID_IMAGE or 413 IMAGE_TOO_LARGE.
 *   5. Vision provider (providers/* → selected at boot) →
 *      502 UPSTREAM / 503 PROVIDER_DISABLED on failure.
 *
 *   On 200: decrement quota, fire-and-forget usage record to Firestore
 *   (commit 5 wires this; today's stub does not persist).
 *
 * Spec §3 compliance: the only outbound HTTP the handler triggers is
 * to the configured provider. The provider is selected at boot from
 * config.vision.provider (never at request-time), so a client cannot
 * redirect vision calls to an unapproved endpoint.
 *
 * Request body: multipart/form-data with field `image` (binary) +
 * form fields gameMode (HK|TW) + roundWind + seatWind + optional
 * tilesAlreadyKnown.
 */

import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { normalizeUpload } from '../services/imagePipeline.js';
import type { VisionProvider } from '../providers/visionProvider.js';
import type { MahjongVisionResult, VisionAnalyzeResponse } from '../types.js';

export interface VisionRouterDeps {
  /** Selected provider (stub or minimax). Boot-time decision. */
  provider: VisionProvider;
  /** Reads the user's current entitlement state. Pre-quota check. */
  isPremium: (uid: string) => Promise<{ isPremium: boolean; canUseAi: boolean; remainingAiUses: number }>;
  /** Decrement quota atomically on successful vision call. */
  decrementQuota: (uid: string) => Promise<void>;
}

export function createVisionRouter(deps: VisionRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.vision.maxImageBytes },
  });

  router.post('/vision/analyze', upload.single('image'), async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
      }
      const uid = req.auth.uid;

      // Step 2: entitlement gate
      const ent = await deps.isPremium(uid);
      if (!ent.isPremium) {
        throw new ApiError('AI_PREMIUM_REQUIRED', 'AI 識別需要 PRO 會員');
      }
      if (!ent.canUseAi) {
        throw new ApiError('AI_PREMIUM_REQUIRED', '本月用量已用完');
      }

      // Step 3: explicit quota check (defense-in-depth in case isPremium
      // is stale; real quota counter lives in Firestore in commit 6)
      if (ent.remainingAiUses <= 0) {
        throw new ApiError('QUOTA_EXCEEDED', '本月用量已用完', { retryAfterDays: null });
      }

      // Step 4: image pipeline (size + magic-byte sniff)
      const file = req.file;
      if (!file) {
        throw new ApiError('BAD_REQUEST', 'multipart "image" field required');
      }
      const normalized = normalizeUpload(file);

      // Validate form fields
      const gameMode = (req.body.gameMode ?? '').toUpperCase();
      const roundWind = req.body.roundWind ?? '';
      const seatWind = req.body.seatWind ?? '';
      if (gameMode !== 'HK' && gameMode !== 'TW') {
        throw new ApiError('BAD_REQUEST', 'gameMode must be HK or TW');
      }
      if (!roundWind || !['東', '南', '西', '北'].includes(roundWind)) {
        throw new ApiError('BAD_REQUEST', 'roundWind must be 東/南/西/北');
      }
      if (!seatWind || !['東', '南', '西', '北'].includes(seatWind)) {
        throw new ApiError('BAD_REQUEST', 'seatWind must be 東/南/西/北');
      }

      // Step 5: provider call. Provider throws ApiError on its own
      // failure modes (UPSTREAM/PROVIDER_DISABLED/PROVIDER_UNAVAILABLE).
      const result: MahjongVisionResult = await deps.provider.analyze({
        imageBytes: normalized.bytes,
        imageMime: normalized.mime,
        gameMode,
        roundWind,
        seatWind,
        tilesAlreadyKnown: req.body.tilesAlreadyKnown,
      });

      // Decrement quota on success. Fire-and-forget so a quota write
      // failure doesn't fail the user's already-successful vision call.
      const decrement = deps.decrementQuota(uid).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[vision] quota decrement failed', e);
      });

      const remaining = Math.max(0, ent.remainingAiUses - 1);
      const response: VisionAnalyzeResponse = {
        requestId: `req_${randomUUID()}`,
        provider: deps.provider.name,
        result,
        usage: { remainingAiUses: remaining },
      };
      res.status(200).json(response);

      await decrement;
    } catch (e) {
      next(e);
    }
  });

  return router;
}
