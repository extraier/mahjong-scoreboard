/**
 * api/index.ts — Vercel serverless entry point.
 *
 * Wraps the Express app (`createApp()`) in a Node-compatible serverless
 * handler. Every request under `/api/*` is forwarded to Express; anything
 * else falls through to Vercel's static hosting (the Vite `dist/` output).
 *
 * Why this file has to exist:
 *   `server/src/app.ts` documents that both `index.ts` (local dev) and
 *   `api/index.ts` (Vercel) call `createApp()`. Without it, Vercel has no
 *   function to route `/api/*` to, so every API request falls through to
 *   the SPA rewrite and returns `index.html` with `content-type: text/html`.
 *   The client then tries to parse HTML as JSON and the app looks broken.
 *
 * Notes:
 *   - `express` v4 is used here (not v5) so the existing route code and
 *     the `errorHandler` middleware keep working unchanged.
 *   - `vercel.json` rewrites `/api/*` to this function; the SPA catch-all
 *     handles everything else.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createApp } from '../server/src/app.js';

const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return new Promise<void>((resolve, reject) => {
    app(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
