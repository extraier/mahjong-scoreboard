/**
 * routes/vision.ts — POST /api/vision/analyze
 *
 * Five-step handler. Each step explicitly fails closed:
 *
 *   1. requireAuth (router-level middleware) → 401 if no Bearer
 *   2. Image pipeline + form fields. A bad photo never consumes a scan.
 *   3. Quota. Lifetime / testing bypass the daily bucket. Free users
 *      reserve one scan, then the provider runs. A provider failure
 *      refunds the scan (a retake does not cost a use). 429 when none
 *      remain. If the counter cannot be read, 502 — never fail open.
 *   4. Vision provider (providers/* → selected at boot) →
 *      502 UPSTREAM / 503 PROVIDER_DISABLED on failure.
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
import { buildVisionCallRecord, logVisionCall } from '../services/visionTelemetry.js';
import { recordCorrection, diffTiles } from '../services/corrections.js';
import type { VisionProvider } from '../providers/visionProvider.js';
import type {
  MahjongVisionResult,
  VisionAnalyzeResponse,
  VisionCorrectRequest,
  VisionCorrectResponse,
} from '../types.js';
import type { QuotaView } from '../services/visionQuota.js';
import { QuotaRejectedError } from '../services/visionQuotaStore.js';

export interface VisionAccess {
  isPremium: boolean;
  canUseAi: boolean;
  /** null = unlimited (lifetime). */
  remainingAiUses: number | null;
  /** Lifetime, QA allowlist, and paid finite counters skip the daily bucket. */
  bypassDailyQuota: boolean;
  resetAt: string | null;
  adsRemainingToday: number | null;
}

export interface DailyQuota {
  reserve(uid: string): Promise<QuotaView>;
  refund(uid: string): Promise<QuotaView | void>;
}

export interface VisionRouterDeps {
  /** Selected provider (stub or minimax). Boot-time decision. */
  provider: VisionProvider;
  /** Reads the user's current entitlement state. */
  getAccess: (uid: string, email?: string | null) => Promise<VisionAccess>;
  /**
   * Decrement a paid finite counter after success. No-op for lifetime
   * (null quota) and for testing accounts that have no entitlement doc.
   */
  decrementQuota: (uid: string) => Promise<void>;
  /** Free-tier daily bucket. Unused when getAccess says bypassDailyQuota. */
  dailyQuota: DailyQuota;
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

      // Image + form checks happen before any quota reservation. A failed
      // photo, a retake of a bad file, or opening the camera (which never
      // reaches this route) must not consume a scan.
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

      const access = await deps.getAccess(uid, req.auth.email ?? null);
      let reserved = false;
      let remainingAfter: number | null = access.remainingAiUses;

      if (access.bypassDailyQuota) {
        if (!access.canUseAi || (access.remainingAiUses !== null && access.remainingAiUses <= 0)) {
          throw new ApiError('QUOTA_EXCEEDED', 'AI 識別次數已用完', {
            remainingAiUses: 0,
            resetAt: access.resetAt,
            adsRemainingToday: null,
          });
        }
      } else {
        try {
          const view = await deps.dailyQuota.reserve(uid);
          reserved = true;
          remainingAfter = view.remaining;
        } catch (e) {
          if (e instanceof QuotaRejectedError) {
            throw new ApiError('QUOTA_EXCEEDED', '今日 AI 識別次數已用完', {
              remainingAiUses: 0,
              resetAt: e.view.resetAt,
              adsRemainingToday: e.view.adsRemaining,
            });
          }
          // Fail closed. A missing counter must not become unlimited scans.
          // PROVIDER_UNAVAILABLE is 502 in the shared status map.
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            '暫時未能核對今日識別次數，請稍後再試。手動計分唔受影響。',
          );
        }
      }

      let result: MahjongVisionResult;
      try {
        result = await deps.provider.analyze({
          imageBytes: normalized.bytes,
          imageMime: normalized.mime,
          gameMode,
          roundWind,
          seatWind,
          tilesAlreadyKnown: req.body.tilesAlreadyKnown,
        });
      } catch (providerError) {
        if (reserved) {
          reserved = false;
          await deps.dailyQuota.refund(uid).catch((refundError) => {
            // eslint-disable-next-line no-console
            console.error('[vision] quota refund failed', refundError);
          });
        }
        throw providerError;
      }

      // Paid finite counters (not the free daily bucket, which was
      // reserved above). Lifetime is a no-op inside decrementQuota.
      if (access.bypassDailyQuota && access.remainingAiUses !== null) {
        await deps.decrementQuota(uid).catch((e) => {
          // eslint-disable-next-line no-console
          console.error('[vision] quota decrement failed', e);
        });
        remainingAfter = Math.max(0, access.remainingAiUses - 1);
      }

      const requestId = `req_${randomUUID()}`;
      void logVisionCall(
        buildVisionCallRecord({
          uid,
          imageBytes: normalized.bytes,
          result,
          provider: deps.provider.name,
          requestId,
        }),
      );

      const response: VisionAnalyzeResponse = {
        requestId,
        provider: deps.provider.name,
        result,
        usage: { remainingAiUses: remainingAfter },
      };
      res.status(200).json(response);
    } catch (e) {
      next(e);
    }
  });

  /**
   * POST /api/vision/correct — record the player's correction to a previous
   * AI prediction. Any signed-in user may correct their own call. This does
   * not consume a vision scan.
   *
   * Body: { request_id, corrected_tiles, note?, photo_consent }
   * Response: { request_id, diff_count, message }
   *
   * Side effects:
   * - Looks up the original vision_calls doc by request_id to get the
   *   predicted_tiles + image_hash. (If the original call has been pruned
   *   we accept the write anyway; the corrected_tiles are still useful.)
   * - Writes a vision_corrections doc linking prediction → ground truth.
   */
  router.post('/vision/correct', async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
      }
      const uid = req.auth.uid;

      const body = req.body as Partial<VisionCorrectRequest>;
      if (!body || typeof body.request_id !== 'string' || !body.request_id.startsWith('req_')) {
        throw new ApiError('BAD_REQUEST', 'request_id required (must be a req_ UUID from /vision/analyze)');
      }
      if (!Array.isArray(body.corrected_tiles) || body.corrected_tiles.length === 0) {
        throw new ApiError('BAD_REQUEST', 'corrected_tiles must be a non-empty array of tile names');
      }
      if (body.corrected_tiles.length > 14) {
        throw new ApiError('BAD_REQUEST', 'corrected_tiles cannot exceed 14 (max hand size + 1)');
      }
      if (typeof body.photo_consent !== 'boolean') {
        throw new ApiError('BAD_REQUEST', 'photo_consent must be a boolean');
      }

      // Look up the original call so we can compute diff + carry over image_hash.
      let predictedTiles: string[] = [];
      let imageHash = '';
      try {
        const { firestore } = (await import('../firebase.js')).getFirebase();
        const snap = await firestore
          .collection('vision_calls')
          .where('request_id', '==', body.request_id)
          .where('uid', '==', uid)
          .limit(1)
          .get();
        if (!snap.empty) {
          const doc = snap.docs[0].data();
          predictedTiles = doc.predicted_tiles ?? [];
          imageHash = doc.image_hash ?? '';
        }
      } catch (e) {
        // Firestore lookup failure is non-fatal; we still record the correction.
        // eslint-disable-next-line no-console
        console.warn('[vision/correct] lookup failed (non-fatal):', e instanceof Error ? e.message : e);
      }

      // If we can't find the original call (different account, pruned, etc.),
      // we still accept the write — but the diff will be empty and the
      // ground-truth tiles are still valuable as fresh data.
      const wrongTiles = predictedTiles.length > 0
        ? diffTiles(predictedTiles, body.corrected_tiles)
        : [];

      void recordCorrection({
        uid,
        request_id: body.request_id,
        image_hash: imageHash,
        predicted_tiles: predictedTiles,
        corrected_tiles: body.corrected_tiles,
        wrong_tiles: wrongTiles,
        note: body.note,
        photo_consent: body.photo_consent,
      });

      const response: VisionCorrectResponse = {
        request_id: body.request_id,
        diff_count: wrongTiles.length,
        message: wrongTiles.length > 0
          ? `已記錄 ${wrongTiles.length} 個錯誤識別。多謝你幫助 AI 學習！`
          : 'AI 識別完全正確。感謝確認！',
      };
      res.status(200).json(response);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
