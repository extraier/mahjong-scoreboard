/**
 * index.ts — local dev entry point. `tsx watch src/index.ts`.
 *
 * For Vercel deploy, see `api/index.ts` which wraps `createApp()` in a
 * serverless handler.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { log } from './log.js';

const app = createApp();

app.listen(config.port, () => {
  log.info('http.listening', { port: config.port });
});
