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
import { createOllamaProvider } from './providers/ollamaVision.js';
import { createLocalVisionProvider } from './providers/localVision.js';
import { computeEntitlementSummary } from './services/entitlements.js';
import type { VisionProvider } from './providers/visionProvider.js';

function selectVisionProvider(): VisionProvider {
  switch (config.vision.provider) {
    case 'local':
      return createLocalVisionProvider();
    case 'ollama':
      return createOllamaProvider();
    case 'stub':
    case 'disabled':
      return createStubProvider();
    case 'minimax':
    default:
      if (!config.vision.apiKey) return createStubProvider();
      return createMinimaxProvider();
  }
}

/**
 * Entitlement reader backed by services/entitlements. Honors the
 * FREE_PREMIUM_TESTING_UIDS + FREE_PREMIUM_TESTING_EMAIL_SUFFIXES env
 * vars for beta testers / internal team members. Firestore-backed
 * subscription state will replace the second branch in a later commit.
 */
function makeIsPremiumClosure() {
  return async (uid: string): Promise<{
    isPremium: boolean;
    canUseAi: boolean;
    remainingAiUses: number;
  }> => {
    // Email is not visible to this closure (only uid is passed). The
    // uid allowlist + the env-driven config still work. If a route
    // needs the email too, refactor isPremium to take AuthContext.
    return computeEntitlementSummary({ uid, email: undefined });
  };
}

/** Stub quota decrement. Replaced in commit 6 with Firestore counter. */
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

  // Vision route with deps wired. Entitlement reads through the
  // entitlements service (FREE_PREMIUM_TESTING_* env vars for beta
  // testers; Firestore-backed subscriptions will replace later).
  const provider = selectVisionProvider();
  const visionRouter = createVisionRouter({
    provider,
    isPremium: makeIsPremiumClosure(),
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
