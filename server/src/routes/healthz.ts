/**
 * healthz.ts — public endpoint returning basic server liveness.
 *
 * No auth, no DB reads. Returns 200 always (unless process is broken).
 * Vercel uses this for deploy smoke; cron watchdog can poll too.
 */

import { Router } from 'express';
import { config } from '../config.js';

export const healthzRouter = Router();

healthzRouter.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    version: '0.2.0',
    visionProvider: config.vision.provider,
    visionConfigured: !!config.vision.apiKey,
    firebaseConfigured: !!config.firebase.projectId,
    gplayConfigured: !!config.googlePlay.packageName,
  });
});
