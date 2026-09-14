/*
 * server/mock-server.js — Phase 1 stand-in for the production backend.
 *
 * Why this exists:
 *   - Phase 1's frontend uses entitlementClient.getEntitlements() and
 *     visionClient.analyzeMahjongImage() — both expect a server behind
 *     them. Real backend (Phase 2) deploys separately; this gives the
 *     same contract over HTTP for dev/QA.
 *   - Spec §8: 'backend 對免費 user 實際拒絕 AI request，而不是只隱藏按鈕'.
 *     The mock honors this: POST /api/vision/analyze for a non-premium
 *     session always returns 403 AI_PREMIUM_REQUIRED.
 *   - Production deploy must NEVER include this file. Phase 2 replaces
 *     it with a real Node/Express/Fastify backend.
 *
 * Endpoints:
 *   GET  /api/me/entitlements   -> { isPremium, adsEnabled, ... } per VITE_MOCK_PREMIUM
 *   POST /api/vision/analyze    -> 403 (free) or canned tile result (premium)
 *   POST /api/dev/premium-on    -> Dev only: toggle VITE_MOCK_PREMIUM (process restart loses it)
 *
 * Run:  npm run dev:mock
 * Env:  VITE_API_BASE_URL=http://localhost:8787 on the Vite side.
 */

import http from 'node:http';
import { URL } from 'node:url';

const PORT = parseInt(process.env.MOCK_PORT || '8787', 10);
let mockPremium = process.env.VITE_MOCK_PREMIUM === '1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
  'Content-Type': 'application/json; charset=utf-8',
};

function jsonResponse(res, status, body) {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function entitlementsResponse() {
  return {
    isPremium: mockPremium,
    adsEnabled: !mockPremium,
    canUseAi: mockPremium,
    remainingAiUses: mockPremium ? 37 : 0,
    resetAt: mockPremium ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
    subscription: mockPremium
      ? {
          platform: 'google_play',
          productId: 'premium_monthly',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          autoRenewing: true,
        }
      : null,
    fetchedAt: new Date().toISOString(),
  };
}

const CANNED_VISION_RESULT = {
  tiles: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'T1', 'T2', 'T3', 'T4', 'T5'],
  flowers: [],
  uncertainTiles: [{ index: 13, reason: '右上角被遮擋（mock server canned）' }],
  confidence: 0.86,
  notes: ['本結果由 mock-server 提供，並非真實 AI 識別。'],
};

const ROUTES = {
  async 'GET /api/me/entitlements'(req, res) {
    jsonResponse(res, 200, entitlementsResponse());
  },

  async 'POST /api/vision/analyze'(req, res) {
    // Spec §8: backend must REJECT non-premium vision requests, not just
    // hide the UI button.
    if (!mockPremium) {
      return jsonResponse(res, 403, {
        code: 'AI_PREMIUM_REQUIRED',
        message: 'Mock server: AI 識別需要 PRO 會員 (POST /api/dev/premium-on 可切換)',
      });
    }
    // Pretend we analyzed the image; latency simulated
    await new Promise((r) => setTimeout(r, 1500));
    jsonResponse(res, 200, {
      requestId: `mock_${Date.now()}`,
      provider: 'minimax',
      result: CANNED_VISION_RESULT,
      usage: { remainingAiUses: 36 },
    });
  },

  async 'POST /api/dev/premium-on'(req, res) {
    mockPremium = true;
    jsonResponse(res, 200, entitlementsResponse());
  },

  async 'POST /api/dev/premium-off'(req, res) {
    mockPremium = false;
    jsonResponse(res, 200, entitlementsResponse());
  },

  async 'GET /api/dev/state'(req, res) {
    jsonResponse(res, 200, {
      mockPremium,
      nodeEnv: process.env.NODE_ENV || 'development',
      uptimeSec: Math.round(process.uptime()),
    });
  },
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${u.pathname}`;
  const handler = ROUTES[key];
  if (!handler) {
    if (req.method === 'OPTIONS') return jsonResponse(res, 204, {});
    return jsonResponse(res, 404, { code: 'INTERNAL', message: `Not found: ${key}` });
  }
  try {
    await handler(req, res);
  } catch (e) {
    jsonResponse(res, 500, { code: 'INTERNAL', message: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-server] listening on http://localhost:${PORT}`);
  console.log(`[mock-server] VITE_MOCK_PREMIUM=${mockPremium ? '1' : '0'}  (toggle: curl -X POST http://localhost:${PORT}/api/dev/premium-{on,off})`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
