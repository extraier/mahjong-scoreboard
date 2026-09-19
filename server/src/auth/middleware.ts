/**
 * middleware.ts — Express middleware collection.
 *
 * `requireAuth` decodes a Firebase Auth ID token from the Bearer header
 * and attaches the decoded claims to req.auth.
 *
 * Phase 2 scope:
 *   - Verify Bearer token via firebase-admin/auth.verifyIdToken
 *   - Reject 401 with structured ApiError when missing/invalid/expired
 *   - Attach { uid, email, email_verified } to req.auth
 *
 * Phase 3 additions (deferred):
 *   - Custom claims check for ADMIN role
 *   - Rate-limit hooks per user
 *
 * Test mode (`AUTH_MODE=test` env): skip token verification and seed
 * req.auth with a fake user. Used by vitest so we don't need to mint
 * a real ID token in unit tests.
 */

import type { NextFunction, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { ApiError } from '../errors.js';

export interface AuthContext {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  /** subject claims — kept opaque, expose only as needed */
  claims?: Record<string, unknown>;
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // Dev/test fast path
  if (process.env.AUTH_MODE === 'test') {
    req.auth = { uid: 'test-user', email: 'test@example.com', emailVerified: true };
    return next();
  }

  const token = extractBearer(req);
  if (!token) {
    return next(new ApiError('UNAUTHENTICATED', 'Missing Authorization: Bearer header'));
  }

  try {
    const decoded = await getAuth().verifyIdToken(token, true /* checkRevoked */);
    req.auth = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      claims: decoded,
    };
    return next();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return next(new ApiError('UNAUTHENTICATED', `Invalid auth token: ${msg}`));
  }
}

/** Optional auth — populates req.auth if a valid token is present but does
 *  NOT reject when missing. Useful for routes that adapt behavior based
 *  on whether a user is signed in. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    req.auth = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      claims: decoded,
    };
    return next();
  } catch {
    // swallow — optional
    return next();
  }
}
