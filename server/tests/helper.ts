/**
 * helper.ts — createApp() wrapped in supertest-friendly HTTP server.
 *
 * Force `AUTH_MODE=*** before createApp() runs so requireAuth auto-fills
 * req.auth with a deterministic test user.
 *
 * Tests should NOT import src/index.ts (which calls listen()). Import
 * the helper instead so multiple tests can spin up isolated servers.
 */

import request from 'supertest';
import type { Express } from 'express';

process.env.AUTH_MODE = process.env.AUTH_MODE ?? 'test';

import { createApp } from '../src/app.js';

export function newTestApp(): Express {
  return createApp();
}

export function http(app: Express) {
  return request(app);
}

export const TEST_UID = 'test-user';
