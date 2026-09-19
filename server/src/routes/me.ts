/**
 * me.ts — current-user endpoints. Phase 2 initial scope:
 *
 *   GET /api/me/entitlements → returns a stub Entitlements reflecting
 *   the auth.uid, so commit 2 can be smoke-tested without requiring
 *   the Firestore + Google Play wiring (commit 3+).
 *
 *   Commit 3 will replace the stub with `computeEntitlements(uid)` that
 *   reads Firestore. Keep the route shape the same; refactor only the
 *   handler body.
 */

import { Router } from 'express';
import { ApiError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import type { Entitlements } from '../types.js';

export const meRouter = Router();

// All routes here require a valid Bearer token.
meRouter.use(requireAuth);

meRouter.get('/me/entitlements', (req, res, next) => {
  try {
    if (!req.auth) {
      throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
    }
    const entitlements: Entitlements = {
      isPremium: false,
      adsEnabled: true,
      canUseAi: false,
      remainingAiUses: 0,
      resetAt: null,
      subscription: null,
      fetchedAt: new Date().toISOString(),
    };
    res.status(200).json(entitlements);
  } catch (e) {
    next(e);
  }
});
