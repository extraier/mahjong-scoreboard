/**
 * routes/accountDeletion.ts — POST /api/account/deletion
 *
 * Google Play requires a working data-deletion path for apps that collect
 * data. The public privacy page (`/mahjong-delete-account.html`) posts here.
 *
 * Design:
 *   - PUBLIC (no auth). A user asking to delete their data may have lost
 *     access to the account, and Play's flow must not dead-end on a 401.
 *     The request carries the email, which is the identifier we act on.
 *   - Writes a `deletion_requests` Firestore doc with the email, the
 *     requested-at timestamp, and the source. A human then processes it
 *     within 30 days (as the privacy page promises).
 *   - Deliberately does NOT delete anything automatically: entitlement and
 *     usage docs are keyed by uid, and an attacker could otherwise wipe
 *     another user's data by submitting their email.
 *
 * Rate limiting is deliberately NOT implemented here — it would need a
 * per-IP store we don't have in the serverless function. The write is
 * idempotent-ish (one doc per request) and cheap; abuse is bounded by
 * Firestore quotas. If abuse shows up, add a Cloud Armor / Vercel WAF rule
 * in front of this path.
 *
 * Body: { email: string, note?: string, source?: string }
 * Response 202: { ok: true, requestId: string }
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { getFirebase } from '../firebase.js';
import { log } from '../log.js';

export const DELETION_COLLECTION = 'deletion_requests';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const accountDeletionRouter = Router();

accountDeletionRouter.post('/account/deletion', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email)) {
      throw new ApiError('BAD_REQUEST', 'email is required and must be a valid address');
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : '';
    const source = typeof req.body?.source === 'string' ? req.body.source.slice(0, 100) : 'web';

    const requestId = `del_${randomUUID()}`;

    try {
      const { firestore } = getFirebase();
      await firestore.collection(DELETION_COLLECTION).add({
        request_id: requestId,
        email,
        note,
        source,
        status: 'requested',
        requested_at: new Date().toISOString(),
      });
    } catch (e) {
      // Firestore down — do NOT silently pretend we stored it. Surface a
      // 503 so the page can tell the user to email us instead of lying.
      log.error('accountDeletion.writeFailed', { requestId, error: String(e) });
      throw new ApiError(
        'INTERNAL',
        '暫時未能提交，請電郵 roger-lau@outlook.com 我哋幫你手動處理。',
      );
    }

    log.info('accountDeletion.requested', { requestId, source });
    res.status(202).json({ ok: true, requestId });
  } catch (e) {
    next(e);
  }
});
