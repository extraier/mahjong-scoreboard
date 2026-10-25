/**
 * routes/purchase.ts — POST /api/purchase/verify
 *
 * Verifies a Google Play purchase token server-side and grants the
 * corresponding entitlement. The client NEVER decides whether a user is
 * premium — it hands us a purchase token, and Google Play is the
 * authority.
 *
 * Flow:
 *   1. requireAuth → the caller's Firebase uid
 *   2. POST purchases.products.get (or subscriptionsv2.get) with the
 *      product id + purchase token, using the Play service account
 *   3. Check the purchase state (PURCHASED) and, for one-time products,
 *      that it has not already been consumed
 *   4. grantEntitlement() writes entitlements/{uid}
 *   5. Acknowledge the purchase if it is still unacknowledged — Play
 *      REFUNDS unacknowledged purchases after 3 days
 *
 * The client may ALSO call this after a purchase completes. Calling it
 * twice for the same token is safe: grantEntitlement merges, and the
 * acknowledge call is idempotent.
 *
 * IMPORTANT — the Play service account must have the "Release manager"
 * permission on the app, and GOOGLE_PLAY_SA_KEY / GOOGLE_PLAY_PACKAGE_NAME
 * must be set. Without them this route returns 503 with a clear message
 * rather than silently granting premium.
 */

import { Router } from 'express';
import { ApiError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { grantEntitlement } from '../services/entitlements.js';
import { verifyPlayPurchase } from '../services/playPurchases.js';

export const purchaseRouter = Router();

purchaseRouter.use(requireAuth);

purchaseRouter.post('/purchase/verify', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
    }

    const body = req.body as { productId?: string; purchaseToken?: string };
    const productId = body?.productId;
    const purchaseToken = body?.purchaseToken;

    if (!productId || typeof productId !== 'string') {
      throw new ApiError('BAD_REQUEST', 'productId required');
    }
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      throw new ApiError('BAD_REQUEST', 'purchaseToken required');
    }
    if (!config.googlePlay.packageName || !config.googlePlay.serviceAccountKey) {
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        '付費驗證未設定（GOOGLE_PLAY_PACKAGE_NAME / GOOGLE_PLAY_SA_KEY）',
      );
    }

    const result = await verifyPlayPurchase({
      packageName: config.googlePlay.packageName,
      productId,
      purchaseToken,
      serviceAccountKey: config.googlePlay.serviceAccountKey,
    });

    if (!result.verified) {
      throw new ApiError('BAD_REQUEST', `購買未確認：${result.reason}`);
    }

    await grantEntitlement({
      uid: req.auth.uid,
      email: req.auth.email ?? null,
      productId: result.productId,
      lifetime: result.lifetime,
      expiresAt: result.expiresAt,
      autoRenewing: result.autoRenewing,
      purchaseToken,
    });

    log.info('purchase.verified', {
      uid: req.auth.uid,
      productId: result.productId,
      lifetime: result.lifetime,
    });

    res.status(200).json({
      ok: true,
      productId: result.productId,
      lifetime: result.lifetime,
      expiresAt: result.expiresAt,
    });
  } catch (e) {
    next(e);
  }
});
