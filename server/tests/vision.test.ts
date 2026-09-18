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
    expect(res.body.provider).toBe('stub'); // VISION_PROVIDER unset → stub by default
    expect(res.body.result.tiles).toEqual(expect.any(Array));
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
