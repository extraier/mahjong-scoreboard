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
import { healthzRouter } from './routes/healthz.js';
import { meRouter } from './routes/me.js';
// Routes get wired in subsequent commits:
// import { meRouter } from './routes/me.js';
// import { visionRouter } from './routes/vision.js';
// import { billingRouter } from './routes/billing.js';

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

  // Authenticated routes (vision/billing) wired in subsequent commits
  // app.use('/api', requireAuth, visionRouter);

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
