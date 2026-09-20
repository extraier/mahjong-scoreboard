/**
 * auth.test.ts — verifies requireAuth middleware behavior under three
 * modes: AUTH_MODE=test (auto pass), invalid Bearer (401), missing
 * Bearer (401).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

// Force test mode BEFORE importing app
beforeAll(() => {
  process.env.AUTH_MODE = 'test';
});

async function authOffApp(): Promise<Express> {
  // Temporarily flip AUTH_MODE off; createApp() captures env at first call.
  const prev = process.env.AUTH_MODE;
  delete process.env.AUTH_MODE;
  // Dynamic import so the module evaluates after env change
  const mod = await import('../src/app.js');
  process.env.AUTH_MODE = prev ?? 'test';
  return mod.createApp();
}

describe('requireAuth', () => {
  it('/api/me/entitlements returns 200 with test-user (premium via FREE_PREMIUM_TESTING_UIDS)', async () => {
    process.env.AUTH_MODE = 'test';
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await request(app).get('/api/me/entitlements');
    expect(res.status).toBe(200);
    // test-user is in the default FREE_PREMIUM_TESTING_UIDS allowlist
    // (set in vitest.config.ts) so it should report as premium.
    expect(res.body).toMatchObject({
      isPremium: true,
      adsEnabled: false,
      canUseAi: true,
    });
    expect(res.body.remainingAiUses).toBeGreaterThan(0);
    expect(res.body.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('AUTH_MODE unset + no Bearer → 401 UNAUTHENTICATED', async () => {
    const prev = process.env.AUTH_MODE;
    delete process.env.AUTH_MODE;
    try {
      const { createApp } = await import('../src/app.js');
      const app = createApp();
      const res = await request(app).get('/api/me/entitlements');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      expect(res.body.message).toMatch(/Missing/);
    } finally {
      process.env.AUTH_MODE = prev ?? 'test';
    }
  });

  it('AUTH_MODE unset + bad Bearer → 401 (firebase-admin fails on init when not configured)', async () => {
    const prev = process.env.AUTH_MODE;
    delete process.env.AUTH_MODE;
    try {
      const { createApp } = await import('../src/app.js');
      const app = createApp();
      const res = await request(app)
        .get('/api/me/entitlements')
        .set('Authorization', 'Bearer this-is-not-a-real-token');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    } finally {
      process.env.AUTH_MODE = prev ?? 'test';
    }
  });
});

describe('error handler', () => {
  it('converts ApiError to structured JSON with correct status', () => {
    // toResponseBody() is the heart of error handler. Direct unit test
    // avoids having to wrestle with Express middleware ordering when a
    // route is registered after createApp() returns.
    process.env.AUTH_MODE = 'test';
    return import('../src/errors.js').then(({ ApiError, toResponseBody }) => {
      const err = new ApiError('BAD_REQUEST', 'intentional test failure', { field: 'x' });
      const { status, body } = toResponseBody(err);
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'intentional test failure',
      });
      expect(body.details).toEqual({ field: 'x' });
    });
  });

  it('unknown error → 500 INTERNAL', async () => {
    process.env.AUTH_MODE = 'test';
    const { toResponseBody } = await import('../src/errors.js');
    const { status, body } = toResponseBody(new Error('boom'));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('boom');
  });
});
