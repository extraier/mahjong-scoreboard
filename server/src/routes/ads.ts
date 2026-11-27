/**
 * Rewarded-ad callbacks.
 *
 *   GET  /api/ads/admob-ssv
 *     Public. Google AdMob calls this after a rewarded video. The query
 *     string is signature-checked (services/admobSsv). A valid, new
 *     transaction grants +5 scans, capped at 3 ads per Hong Kong day.
 *     Lifetime / testing accounts are acknowledged with granted:false so
 *     AdMob does not retry, and their quota doc is left alone.
 *
 *   POST /api/ads/reward/dev-claim
 *     Authenticated. Grants one ad reward WITHOUT a Google signature.
 *     Enabled only when ADMOB_REWARD_DEV_MODE=1 and NODE_ENV is not
 *     production. Test ads do not fire SSV, so this is how a device build
 *     can exercise the quota before the AdMob callback URL exists.
 *     Production always responds 404 — a client cannot grant itself scans.
 */

import { Router } from 'express';
import { ApiError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { isRewardDevModeEnabled } from '../config.js';
import { log } from '../log.js';
import { verifyAdmobRewardQuery, type SsvVerdict } from '../services/admobSsv.js';
import { grantRewardedScans, type AdGrantResult, type QuotaGate } from '../services/visionQuotaStore.js';
import { computeEntitlementSummary } from '../services/entitlements.js';

export interface AdsRouterDeps {
  verify?: (rawQuery: string) => Promise<SsvVerdict>;
  quota?: Pick<QuotaGate, 'grantAd'>;
  devClaimEnabled?: () => boolean;
  /** Return false for lifetime / testing accounts, which must not bank ad scans. */
  shouldGrant?: (uid: string) => Promise<boolean>;
}

async function defaultShouldGrant(uid: string): Promise<boolean> {
  const ent = await computeEntitlementSummary({ uid });
  return !ent.bypassDailyQuota;
}

function grantBody(result: AdGrantResult) {
  return {
    ok: true,
    granted: result.granted,
    duplicate: result.duplicate,
    capped: result.capped,
    remainingAiUses: result.view.remaining,
    adsRemainingToday: result.view.adsRemaining,
    resetAt: result.view.resetAt,
  };
}

export function createAdsRouter(deps: AdsRouterDeps = {}): Router {
  const router = Router();
  const verify = deps.verify ?? verifyAdmobRewardQuery;
  const quota = deps.quota ?? { grantAd: grantRewardedScans };
  const devClaimEnabled = deps.devClaimEnabled ?? isRewardDevModeEnabled;
  const shouldGrant = deps.shouldGrant ?? defaultShouldGrant;

  router.get('/ads/admob-ssv', async (req, res, next) => {
    try {
      const rawQuery = (req.originalUrl.split('?')[1] ?? '').trim();
      const verdict = await verify(rawQuery);
      if (!verdict.ok) {
        log.warn('admob.ssv_rejected', { reason: verdict.reason });
        throw new ApiError('FORBIDDEN', 'invalid admob ssv callback');
      }

      if (!(await shouldGrant(verdict.userId))) {
        res.status(200).json({ ok: true, granted: false, reason: 'not_applicable' });
        return;
      }

      const result = await quota.grantAd(verdict.userId, verdict.transactionId);
      log.info('admob.ssv_granted', {
        uid: verdict.userId,
        granted: result.granted,
        duplicate: result.duplicate,
        capped: result.capped,
      });
      res.status(200).json(grantBody(result));
    } catch (e) {
      next(e);
    }
  });

  router.post('/ads/reward/dev-claim', requireAuth, async (req, res, next) => {
    try {
      if (!devClaimEnabled()) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'No route for POST /api/ads/reward/dev-claim',
        });
        return;
      }
      if (!req.auth) {
        throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
      }
      if (!(await shouldGrant(req.auth.uid))) {
        res.status(200).json({ ok: true, granted: false, reason: 'not_applicable', remainingAiUses: null });
        return;
      }
      const result = await quota.grantAd(req.auth.uid, null);
      log.info('admob.dev_claim', { uid: req.auth.uid, granted: result.granted, capped: result.capped });
      res.status(200).json(grantBody(result));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
