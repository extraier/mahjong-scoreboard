/**
 * me.ts — current-user endpoints.
 *
 *   GET /api/me/entitlements → returns the user's current entitlement set
 *   (premium status, quota remaining, subscription metadata). Backed by
 *   services/entitlements.computeEntitlements, which honors the
 *   FREE_PREMIUM_TESTING_UIDS + FREE_PREMIUM_TESTING_EMAIL_SUFFIXES env
 *   vars for beta testers and internal team members.
 *
 *   When the Firestore-backed production entitlement service is wired
 *   (commit 4+), only the implementation of computeEntitlements changes —
 *   this route stays the same.
 */

import { Router } from 'express';
import { ApiError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { computeEntitlements } from '../services/entitlements.js';

export const meRouter = Router();

// All routes here require a valid Bearer token.
meRouter.use(requireAuth);

meRouter.get('/me/entitlements', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new ApiError('UNAUTHENTICATED', 'requireAuth did not populate req.auth');
    }
    const entitlements = await computeEntitlements({
      uid: req.auth.uid,
      email: req.auth.email ?? null,
    });
    res.status(200).json(entitlements);
  } catch (e) {
    next(e);
  }
});
