/**
 * Daily vision quota.
 *
 * Covers the product rules:
 *   - a successful analyze consumes one scan
 *   - a failed analyze / invalid photo does not
 *   - counters reset at 00:00 Asia/Hong_Kong
 *   - a rewarded ad adds 5 scans, and a 4th ad the same day does not
 *   - lifetime bypasses the bucket
 *   - a free user with 0 scans is rejected and the provider is not called
 */

import { createSign, generateKeyPairSync } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { toResponseBody } from '../src/errors.js';
import { ApiError } from '../src/errors.js';
import { isRewardDevModeEnabled } from '../src/config.js';
import { createVisionRouter, type VisionAccess } from '../src/routes/vision.js';
import { createAdsRouter } from '../src/routes/ads.js';
import { createStubProvider } from '../src/providers/stubProvider.js';
import type { VisionProvider } from '../src/providers/visionProvider.js';
import {
  applyQuotaMutation,
  hongKongDayKey,
  nextHongKongMidnightIso,
  viewFromStored,
  type QuotaState,
} from '../src/services/visionQuota.js';
import { createMemoryQuotaGate, QuotaRejectedError } from '../src/services/visionQuotaStore.js';
import { verifyAdmobRewardQuery, verifySsvContent } from '../src/services/admobSsv.js';

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
  'hex',
);

// 2026-11-26 23:59:59 HK, and the following midnight (2026-11-27 00:00 HK).
const JUST_BEFORE_MIDNIGHT = new Date('2026-11-26T15:59:59.000Z');
const HK_MIDNIGHT = new Date('2026-11-26T16:00:00.000Z');

const FREE: VisionAccess = {
  isPremium: false,
  canUseAi: true,
  remainingAiUses: 3,
  bypassDailyQuota: false,
  resetAt: HK_MIDNIGHT.toISOString(),
  adsRemainingToday: 3,
};

const LIFETIME: VisionAccess = {
  isPremium: true,
  canUseAi: true,
  remainingAiUses: null,
  bypassDailyQuota: true,
  resetAt: null,
  adsRemainingToday: null,
};

function analyzeApp(opts: {
  access: VisionAccess;
  provider: VisionProvider;
  gate: ReturnType<typeof createMemoryQuotaGate>;
  decrements?: { n: number };
}): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', createVisionRouter({
    provider: opts.provider,
    getAccess: async () => opts.access,
    decrementQuota: async () => {
      if (opts.decrements) opts.decrements.n += 1;
    },
    dailyQuota: opts.gate,
  }));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = toResponseBody(err);
    res.status(status).json(body);
  });
  return app;
}

function postAnalyze(app: Express, image: Buffer = TINY_PNG, filename = 'hand.png') {
  return request(app)
    .post('/api/vision/analyze')
    .set('Authorization', 'Bearer test-token')
    .field('gameMode', 'HK')
    .field('roundWind', '東')
    .field('seatWind', '東')
    .attach('image', image, { filename, contentType: 'image/png' });
}

describe('vision quota day boundary (Asia/Hong_Kong)', () => {
  it('rolls the calendar day at 00:00 Hong Kong time', () => {
    expect(hongKongDayKey(JUST_BEFORE_MIDNIGHT)).toBe('2026-11-26');
    expect(nextHongKongMidnightIso(JUST_BEFORE_MIDNIGHT)).toBe('2026-11-26T16:00:00.000Z');
    expect(hongKongDayKey(HK_MIDNIGHT)).toBe('2026-11-27');
    expect(nextHongKongMidnightIso(HK_MIDNIGHT)).toBe('2026-11-27T16:00:00.000Z');
  });

  it('resets successful scans and the ad cap on the new Hong Kong day', () => {
    const exhausted: QuotaState = {
      dayKey: '2026-11-26',
      successfulScans: 18,
      adsWatched: 3,
      bonusScans: 15,
    };
    const view = viewFromStored(exhausted, HK_MIDNIGHT);
    expect(view.dayKey).toBe('2026-11-27');
    expect(view.successfulScans).toBe(0);
    expect(view.adsWatched).toBe(0);
    expect(view.bonusScans).toBe(0);
    expect(view.remaining).toBe(3);
    expect(view.adsRemaining).toBe(3);
  });
});

describe('vision quota transitions', () => {
  it('consumes a scan only when reserved, and a refund gives it back', () => {
    const reserved = applyQuotaMutation(null, 'reserve', HK_MIDNIGHT);
    expect(reserved.result).toBe('ok');
    expect(reserved.view.remaining).toBe(2);

    const refunded = applyQuotaMutation(reserved.state, 'refund', HK_MIDNIGHT);
    expect(refunded.view.remaining).toBe(3);
    expect(refunded.view.successfulScans).toBe(0);
  });

  it('rejects a reserve when remaining is 0 and does not change the counter', () => {
    const empty: QuotaState = {
      dayKey: '2026-11-27',
      successfulScans: 3,
      adsWatched: 0,
      bonusScans: 0,
    };
    const rejected = applyQuotaMutation(empty, 'reserve', HK_MIDNIGHT);
    expect(rejected.result).toBe('rejected');
    expect(rejected.state.successfulScans).toBe(3);
    expect(rejected.view.remaining).toBe(0);
  });

  it('grants +5 scans per ad and stops at 3 ads', () => {
    let state: QuotaState | null = null;
    for (let i = 0; i < 3; i++) {
      const granted = applyQuotaMutation(state, 'grant_ad', HK_MIDNIGHT);
      expect(granted.result).toBe('ok');
      state = granted.state;
    }
    expect(viewFromStored(state, HK_MIDNIGHT).remaining).toBe(3 + 15);
    expect(viewFromStored(state, HK_MIDNIGHT).adsRemaining).toBe(0);

    const fourth = applyQuotaMutation(state, 'grant_ad', HK_MIDNIGHT);
    expect(fourth.result).toBe('capped');
    expect(fourth.view.remaining).toBe(18);
    expect(fourth.state.adsWatched).toBe(3);
  });
});

describe('POST /api/vision/analyze quota enforcement', () => {
  it('consumes one scan on success and rejects the next call once the bucket is empty', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    let calls = 0;
    const provider: VisionProvider = {
      name: 'stub',
      async analyze(input) {
        calls += 1;
        return createStubProvider().analyze(input);
      },
    };
    const app = analyzeApp({ access: FREE, provider, gate });

    const first = await postAnalyze(app);
    expect(first.status).toBe(200);
    expect(first.body.usage.remainingAiUses).toBe(2);
    expect(calls).toBe(1);

    await postAnalyze(app);
    await postAnalyze(app);
    expect((await gate.read('test-user', HK_MIDNIGHT)).remaining).toBe(0);

    const blocked = await postAnalyze(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('QUOTA_EXCEEDED');
    expect(calls).toBe(3);
    expect((await gate.read('test-user', HK_MIDNIGHT)).successfulScans).toBe(3);
  });

  it('does not consume a scan when the provider fails, so a retake still has its scan', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    let calls = 0;
    const provider: VisionProvider = {
      name: 'stub',
      async analyze(input) {
        calls += 1;
        if (calls === 1) throw new ApiError('UPSTREAM', 'model unavailable');
        return createStubProvider().analyze(input);
      },
    };
    const app = analyzeApp({ access: FREE, provider, gate });

    const failed = await postAnalyze(app);
    expect(failed.status).toBe(502);
    expect((await gate.read('test-user', HK_MIDNIGHT)).successfulScans).toBe(0);
    expect((await gate.read('test-user', HK_MIDNIGHT)).remaining).toBe(3);

    const retried = await postAnalyze(app);
    expect(retried.status).toBe(200);
    expect(retried.body.usage.remainingAiUses).toBe(2);
    expect((await gate.read('test-user', HK_MIDNIGHT)).successfulScans).toBe(1);
  });

  it('does not consume a scan for an invalid image', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    let calls = 0;
    const provider: VisionProvider = {
      name: 'stub',
      async analyze(input) {
        calls += 1;
        return createStubProvider().analyze(input);
      },
    };
    const app = analyzeApp({ access: FREE, provider, gate });
    const res = await postAnalyze(app, Buffer.from('not-an-image'), 'nope.bin');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IMAGE');
    expect(calls).toBe(0);
    expect((await gate.read('test-user', HK_MIDNIGHT)).successfulScans).toBe(0);
  });

  it('lets a lifetime user analyze with an empty daily bucket and does not touch it', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    for (let i = 0; i < 3; i++) await gate.reserve('test-user', HK_MIDNIGHT);
    expect((await gate.read('test-user', HK_MIDNIGHT)).remaining).toBe(0);

    const decrements = { n: 0 };
    const app = analyzeApp({
      access: LIFETIME,
      provider: createStubProvider(),
      gate,
      decrements,
    });
    const res = await postAnalyze(app);
    expect(res.status).toBe(200);
    expect(res.body.usage.remainingAiUses).toBeNull();
    expect(decrements.n).toBe(0);
    expect((await gate.read('test-user', HK_MIDNIGHT)).successfulScans).toBe(3);
  });

  it('fails closed when the daily counter cannot be read', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    const broken = {
      reserve: async () => {
        throw new Error('firestore down');
      },
      refund: async () => {
        throw new Error('firestore down');
      },
    };
    let calls = 0;
    const provider: VisionProvider = {
      name: 'stub',
      async analyze(input) {
        calls += 1;
        return createStubProvider().analyze(input);
      },
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createVisionRouter({
      provider,
      getAccess: async () => FREE,
      decrementQuota: async () => undefined,
      dailyQuota: broken,
    }));
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      const { status, body } = toResponseBody(err);
      res.status(status).json(body);
    });
    const res = await postAnalyze(app);
    expect(res.status).toBe(502);
    expect(calls).toBe(0);
    expect(res.body.message).toMatch(/手動計分/);
  });
});

describe('rewarded-ad grants', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  function signedQuery(fields: Record<string, string>): string {
    const content = new URLSearchParams(fields).toString();
    const signature = createSign('SHA256').update(content).sign(privateKey).toString('base64url');
    return `${content}&signature=${encodeURIComponent(signature)}&key_id=1`;
  }

  it('accepts a valid AdMob SSV signature and rejects a tampered user id', async () => {
    const query = signedQuery({
      ad_network: '5450213213286189855',
      ad_unit: '123',
      reward_amount: '1',
      reward_item: 'scan',
      timestamp: '1700000000000',
      transaction_id: 'txn-1',
      user_id: 'player-1',
    });
    const cut = query.lastIndexOf('&signature=');
    expect(verifySsvContent(query.slice(0, cut), new URLSearchParams(query).get('signature') ?? '', pem)).toBe(true);

    const verdict = await verifyAdmobRewardQuery(query, { keys: new Map([['1', pem]]) });
    expect(verdict).toMatchObject({ ok: true, userId: 'player-1', transactionId: 'txn-1' });

    const tampered = query.replace('user_id=player-1', 'user_id=someone-else');
    const bad = await verifyAdmobRewardQuery(tampered, { keys: new Map([['1', pem]]) });
    expect(bad.ok).toBe(false);
  });

  it('grants +5 once per transaction, caps the 4th ad, and ignores a lifetime user', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    const app = express();
    app.use(express.json());
    app.use('/api', createAdsRouter({
      verify: async (raw) => {
        const params = new URLSearchParams(raw);
        const userId = params.get('user_id') ?? '';
        const transactionId = params.get('transaction_id') ?? '';
        if (params.get('signature') !== 'good') return { ok: false, reason: 'bad_signature' };
        return { ok: true, userId, transactionId, keyId: '1' };
      },
      quota: gate,
      devClaimEnabled: () => false,
      shouldGrant: async (uid) => uid !== 'lifetime-user',
    }));
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      const { status, body } = toResponseBody(err);
      res.status(status).json(body);
    });

    const forged = await request(app).get('/api/ads/admob-ssv').query({
      user_id: 'free-user',
      transaction_id: 't1',
      signature: 'nope',
    });
    expect(forged.status).toBe(403);
    expect((await gate.read('free-user', HK_MIDNIGHT)).bonusScans).toBe(0);

    const first = await request(app).get('/api/ads/admob-ssv').query({
      user_id: 'free-user',
      transaction_id: 't1',
      signature: 'good',
    });
    expect(first.status).toBe(200);
    expect(first.body.granted).toBe(true);
    expect(first.body.remainingAiUses).toBe(8);

    const replay = await request(app).get('/api/ads/admob-ssv').query({
      user_id: 'free-user',
      transaction_id: 't1',
      signature: 'good',
    });
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.granted).toBe(false);
    expect((await gate.read('free-user', HK_MIDNIGHT)).adsWatched).toBe(1);

    await request(app).get('/api/ads/admob-ssv').query({ user_id: 'free-user', transaction_id: 't2', signature: 'good' });
    await request(app).get('/api/ads/admob-ssv').query({ user_id: 'free-user', transaction_id: 't3', signature: 'good' });
    const fourth = await request(app).get('/api/ads/admob-ssv').query({
      user_id: 'free-user',
      transaction_id: 't4',
      signature: 'good',
    });
    expect(fourth.body.granted).toBe(false);
    expect(fourth.body.capped).toBe(true);
    expect((await gate.read('free-user', HK_MIDNIGHT)).remaining).toBe(18);
    expect((await gate.read('free-user', HK_MIDNIGHT)).adsWatched).toBe(3);

    const lifetime = await request(app).get('/api/ads/admob-ssv').query({
      user_id: 'lifetime-user',
      transaction_id: 't-life',
      signature: 'good',
    });
    expect(lifetime.status).toBe(200);
    expect(lifetime.body.granted).toBe(false);
    expect(lifetime.body.reason).toBe('not_applicable');
    expect((await gate.read('lifetime-user', HK_MIDNIGHT)).adsWatched).toBe(0);
  });

  it('dev claim is 404 unless explicitly enabled, and never when NODE_ENV is production', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    const disabled = express();
    disabled.use(express.json());
    disabled.use('/api', createAdsRouter({
      quota: gate,
      devClaimEnabled: () => false,
      shouldGrant: async () => true,
    }));
    const hidden = await request(disabled).post('/api/ads/reward/dev-claim');
    expect(hidden.status).toBe(404);
    expect((await gate.read('test-user', HK_MIDNIGHT)).adsWatched).toBe(0);

    const enabled = express();
    enabled.use(express.json());
    enabled.use('/api', createAdsRouter({
      quota: gate,
      devClaimEnabled: () => true,
      shouldGrant: async () => true,
    }));
    enabled.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      const { status, body } = toResponseBody(err);
      res.status(status).json(body);
    });
    const claimed = await request(enabled).post('/api/ads/reward/dev-claim');
    expect(claimed.status).toBe(200);
    expect(claimed.body.granted).toBe(true);
    expect(claimed.body.remainingAiUses).toBe(8);

    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.ADMOB_REWARD_DEV_MODE;
    process.env.NODE_ENV = 'production';
    process.env.ADMOB_REWARD_DEV_MODE = '1';
    try {
      expect(isRewardDevModeEnabled()).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.ADMOB_REWARD_DEV_MODE;
      else process.env.ADMOB_REWARD_DEV_MODE = prevFlag;
    }
  });
});

describe('memory gate rejects with QuotaRejectedError', () => {
  it('throws once the bucket is empty', async () => {
    const gate = createMemoryQuotaGate(undefined, () => HK_MIDNIGHT);
    await gate.reserve('u', HK_MIDNIGHT);
    await gate.reserve('u', HK_MIDNIGHT);
    await gate.reserve('u', HK_MIDNIGHT);
    await expect(gate.reserve('u', HK_MIDNIGHT)).rejects.toBeInstanceOf(QuotaRejectedError);
  });
});
