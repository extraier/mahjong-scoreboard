/**
 * vision.test.ts — POST /api/vision/analyze (5-step handler) +
 * ollamaVision.test.ts (provider unit tests with mocked fetch).
 *
 * The two are co-located because they share the ollamaVision module.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createOllamaProvider } from '../src/providers/ollamaVision.js';

process.env.AUTH_MODE = 'test';

// Tiny valid 1×1 transparent PNG
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
  'hex',
);

describe('ollamaVision provider (mocked fetch)', () => {
  let originalFetch: typeof fetch;
  let lastUrl: string | undefined;
  let lastBody: unknown;
  let configuredBaseUrl: string;

  beforeEach(() => {
    originalFetch = global.fetch;
    configuredBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('provider name is "ollama"', () => {
    expect(createOllamaProvider().name).toBe('ollama');
  });

  it('parses a successful JSON-mode response', async () => {
    const fakeTiles = ['W1', 'W2', 'W3', 'T5', 'T5', 'T5', 'S8', 'S8', 'S9', 'S9', 'F1', 'F2', 'F3'];
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      lastUrl = String(url);
      lastBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({
          model: 'minicpm-v',
          response: JSON.stringify({
            tiles: fakeTiles,
            flowers: [],
            uncertainTiles: [{ index: 7, reason: 'tint similar to neighboring tile' }],
            confidence: 0.91,
            notes: ['tile arrangement typical'],
          }),
          eval_count: 200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await createOllamaProvider().analyze({
      imageBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      imageMime: 'image/png',
      gameMode: 'HK',
      roundWind: '東',
      seatWind: '東',
    });

    expect(lastUrl).toBe(`${configuredBaseUrl}/api/generate`);
    expect((lastBody as { model?: string }).model).toBeTruthy();
    expect((lastBody as { images?: unknown[] }).images).toHaveLength(1);
    expect(result.tiles).toEqual(fakeTiles);
    expect(result.confidence).toBeCloseTo(0.91);
  });

  it('throws PROVIDER_UNAVAILABLE on network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(
      createOllamaProvider().analyze({
        imageBytes: new Uint8Array([0x89, 0x50]),
        imageMime: 'image/png',
        gameMode: 'TW',
        roundWind: '南',
        seatWind: '南',
      }),
    ).rejects.toThrow(/ollama request failed/);
  });

  it('throws UPSTREAM on HTTP 500', async () => {
    global.fetch = vi.fn(async () => new Response('internal', { status: 500 })) as typeof fetch;
    await expect(
      createOllamaProvider().analyze({
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        imageMime: 'image/jpeg',
        gameMode: 'HK',
        roundWind: '東',
        seatWind: '東',
      }),
    ).rejects.toThrow(/ollama HTTP 500/);
  });

  it('throws UPSTREAM when response is not valid JSON', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ model: 'minicpm-v', response: 'this is not json {{{' }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(
      createOllamaProvider().analyze({
        imageBytes: new Uint8Array([0, 0, 0]),
        imageMime: 'image/png',
        gameMode: 'HK',
        roundWind: '東',
        seatWind: '東',
      }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe('POST /api/vision/analyze (5-step handler)', () => {
  it('401 without Bearer (real auth mode test)', async () => {
    const prev = process.env.AUTH_MODE;
    delete process.env.AUTH_MODE;
    try {
      const mod = await import('../src/app.js');
      const a = mod.createApp();
      const res = await request(a)
        .post('/api/vision/analyze')
        .field('gameMode', 'HK')
        .field('roundWind', '東')
        .field('seatWind', '東')
        .attach('image', TINY_PNG, { filename: 'hand.png', contentType: 'image/png' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    } finally {
      process.env.AUTH_MODE = prev ?? 'test';
    }
  });

  it('200 with stub provider for test-user (premium), valid PNG', async () => {
    process.env.AUTH_MODE = 'test';
    process.env.VISION_PROVIDER = 'stub';
    vi.resetModules();
    const mod = await import('../src/app.js');
    const a = mod.createApp();
    const res = await request(a)
      .post('/api/vision/analyze')
      .set('Authorization', 'Bearer test-token')
      .field('gameMode', 'HK')
      .field('roundWind', '東')
      .field('seatWind', '東')
      .attach('image', TINY_PNG, { filename: 'hand.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('stub');
    expect(res.body.result.tiles).toEqual(expect.any(Array));
    delete process.env.VISION_PROVIDER;
    vi.resetModules();
  });

  it('400 with no image field', async () => {
    process.env.AUTH_MODE = 'test';
    const mod = await import('../src/app.js');
    const a = mod.createApp();
    const res = await request(a)
      .post('/api/vision/analyze')
      .set('Authorization', 'Bearer test-token')
      .field('gameMode', 'HK')
      .field('roundWind', '東')
      .field('seatWind', '東');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  it('400 INVALID_IMAGE for non-image blob', async () => {
    process.env.AUTH_MODE = 'test';
    const mod = await import('../src/app.js');
    const a = mod.createApp();
    const res = await request(a)
      .post('/api/vision/analyze')
      .set('Authorization', 'Bearer test-token')
      .field('gameMode', 'HK')
      .field('roundWind', '東')
      .field('seatWind', '東')
      .attach('image', Buffer.from('not-an-image'), { filename: 'foo.bin', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IMAGE');
  });

  it('POST /api/vision/correct validates request body', async () => {
    process.env.AUTH_MODE = 'test';
    const mod = await import('../src/app.js');
    const a = mod.createApp();

    // Missing request_id
    const r1 = await request(a)
      .post('/api/vision/correct')
      .set('Authorization', 'Bearer test-token')
      .send({ corrected_tiles: ['C1', 'C2'], photo_consent: false });
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe('BAD_REQUEST');

    // Bad request_id format
    const r2 = await request(a)
      .post('/api/vision/correct')
      .set('Authorization', 'Bearer test-token')
      .send({ request_id: 'not-a-req-uuid', corrected_tiles: ['C1'], photo_consent: true });
    expect(r2.status).toBe(400);

    // Empty corrected_tiles
    const r3 = await request(a)
      .post('/api/vision/correct')
      .set('Authorization', 'Bearer test-token')
      .send({ request_id: 'req_test', corrected_tiles: [], photo_consent: false });
    expect(r3.status).toBe(400);

    // photo_consent not a boolean
    const r4 = await request(a)
      .post('/api/vision/correct')
      .set('Authorization', 'Bearer test-token')
      .send({ request_id: 'req_test', corrected_tiles: ['C1'], photo_consent: 'yes' });
    expect(r4.status).toBe(400);

    // Too many tiles
    const r5 = await request(a)
      .post('/api/vision/correct')
      .set('Authorization', 'Bearer test-token')
      .send({ request_id: 'req_test', corrected_tiles: Array(20).fill('C1'), photo_consent: false });
    expect(r5.status).toBe(400);
  });

  it('diffTiles: counts extras as wrong, missing as wrong, common as correct', async () => {
    process.env.AUTH_MODE = 'test';
    const { diffTiles } = await import('../src/services/corrections.js');

    // Helper: deep-equal regardless of order. Set iteration order is not
    // guaranteed; the function returns the unique tile names, not multiset.
    const sorted = (xs: string[]) => [...xs].sort();
    const eq = (a: string[], b: string[]) => {
      expect(sorted(a)).toEqual(sorted(b));
    };

    // AI predicted 3 tiles, corrected has 3 — but 1 different (W4↔W1 confusion).
    // Both wrong tiles appear in the diff (deduped).
    eq(diffTiles(['W1', 'W2', 'W3'], ['W1', 'W2', 'W4']), ['W3', 'W4']);

    // AI predicted [W1, W2], corrected [W1, W1]. Predicted extra: W2.
    // Corrected extra: W1. Both are wrong.
    eq(diffTiles(['W1', 'W2'], ['W1', 'W1']), ['W1', 'W2']);

    // Same tiles both directions = empty diff
    expect(diffTiles(['C1', 'C2', 'C3'], ['C1', 'C2', 'C3'])).toEqual([]);

    // All wrong (pred + corrected share nothing)
    eq(diffTiles(['W1'], ['C1']), ['W1', 'C1']);

    // Edge case: empty predictions (detector found nothing — user corrects
    // with the right tiles). All corrected tiles should be in the diff.
    eq(diffTiles([], ['C1', 'C2']), ['C1', 'C2']);
  });
});

describe('localVision provider 422 IMAGE_UNCLEAR propagation', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('translates FastAPI 422 quality rejection to ApiError(IMAGE_UNCLEAR) with retry_hint', async () => {
    // Mock the FastAPI server returning a structured quality rejection.
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: 'rejected',
          error_code: 'image_too_blurry',
          error: 'Photo is too blurry to read the tiles.',
          retry_hint: 'Hold the phone steady with both hands, tap to focus.',
          laplacian_variance: 12.3,
          min_laplacian_variance: 80.0,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    process.env.LOCAL_VISION_HTTP_URL = 'http://localhost:8789';
    const { createLocalVisionProvider } = await import('../src/providers/localVision.js');
    const provider = createLocalVisionProvider();

    let caught: unknown;
    try {
      await provider.analyze({
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        imageMime: 'image/jpeg',
        gameMode: 'HK',
        roundWind: '東',
        seatWind: '東',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    const err = caught as { code: string; message: string; details?: Record<string, unknown> };
    expect(err.code).toBe('IMAGE_UNCLEAR');
    expect(err.message).toContain('blurry');
    expect(err.details?.error_code).toBe('image_too_blurry');
    expect(err.details?.retry_hint).toContain('Hold the phone steady');
    expect(err.details?.laplacian_variance).toBe(12.3);
    expect(err.details?.min_laplacian_variance).toBe(80.0);
  });

  it('falls back to generic retry_hint when 422 body is not JSON', async () => {
    global.fetch = vi.fn(async () => {
      return new Response('not json', { status: 422 });
    }) as typeof fetch;

    process.env.LOCAL_VISION_HTTP_URL = 'http://localhost:8789';
    const { createLocalVisionProvider } = await import('../src/providers/localVision.js');
    const provider = createLocalVisionProvider();

    await expect(
      provider.analyze({
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        imageMime: 'image/jpeg',
        gameMode: 'HK',
        roundWind: '東',
        seatWind: '東',
      }),
    ).rejects.toMatchObject({
      code: 'IMAGE_UNCLEAR',
      details: {
        error_code: 'quality_rejected',
      },
    });
  });
});

describe('imagePipeline', () => {
  it('sniffs valid PNG', async () => {
    const { normalizeRaw } = await import('../src/services/imagePipeline.js');
    expect(normalizeRaw(TINY_PNG).mime).toBe('image/png');
  });

  it('rejects non-image data', async () => {
    const { normalizeRaw } = await import('../src/services/imagePipeline.js');
    expect(() => normalizeRaw(Buffer.from('not an image'))).toThrow();
  });
});
