/**
 * app.ts — Express app factory. The `index.ts` and `api/index.ts`
 * (Vercel handler) both call this.
 *
 * Order: errorHandler LAST (Express error middleware).
 */

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { toResponseBody } from './errors.js';
import { log } from './log.js';
import { config } from './config.js';
import { healthzRouter } from './routes/healthz.js';
import { meRouter } from './routes/me.js';
import { createVisionRouter } from './routes/vision.js';
import { createStubProvider } from './providers/stubProvider.js';
import { createMinimaxProvider } from './providers/minimaxVision.js';
import type { VisionProvider } from './providers/visionProvider.js';

function selectVisionProvider(): VisionProvider {
  if (config.vision.provider === 'disabled') return createStubProvider();
  if (!config.vision.apiKey) return createStubProvider();
  return createMinimaxProvider();
}

/**
 * Stub entitlement reader. Replaced in commit 4 with
 * services/entitlements.computeEntitlements(uid).
 */
async function stubIsPremium(uid: string): Promise<{
  isPremium: boolean;
  canUseAi: boolean;
  remainingAiUses: number;
}> {
  const isAdmin = uid === 'admin' || uid === 'test-user';
  return {
    isPremium: isAdmin,
    canUseAi: isAdmin,
    remainingAiUses: isAdmin ? 999 : 0,
  };
}

/** Stub quota decrement. Replaced in commit 6. */
async function stubDecrementQuota(_uid: string): Promise<void> {
  return;
}

export function createApp(): Express {
  const app = express();

  // CORS — open during dev; production frontend is same-origin via Vercel
  // rewrites so this is mostly a no-op there.
  app.use(cors({ origin: true, credentials: false }));

  // JSON body parser — note: image upload route uses multer, not this
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // Request log (one line per request)
  app.use((req, _res, next) => {
    log.debug('http.request', { method: req.method, path: req.path });
    next();
  });

  // Public routes
  app.use('/api', healthzRouter);

  // Authenticated user-facing routes
  app.use('/api', meRouter);

  // Vision route with deps wired (entitlement + quota use stubs;
  // commit 4 + 6 replace the stubs with Firestore-backed implementations).
  const provider = selectVisionProvider();
  const visionRouter = createVisionRouter({
    provider,
    isPremium: stubIsPremium,
    decrementQuota: stubDecrementQuota,
  });
  app.use('/api', visionRouter);

  // 404
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
    });
  });

  // Final error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = toResponseBody(err);
    if (status >= 500) {
      log.error('http.unhandled', { path: req.path, method: req.method, err: err.message });
    }
    res.status(status).json(body);
  });

  return app;
}
