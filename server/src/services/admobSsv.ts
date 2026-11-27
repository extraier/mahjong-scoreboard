/**
 * AdMob rewarded server-side verification.
 *
 * Google calls GET /api/ads/admob-ssv with a query string whose content
 * (everything before `&signature=`) is signed by an ECDSA key published at
 * https://www.gstatic.com/admob/reward/verifier-keys.json
 *
 * No shared secret from the app owner is required. The callback URL itself
 * still has to be saved in the AdMob console, and test ads do not fire SSV
 * (see the AdMob plugin notes). Until that URL is set, production grants
 * will not arrive; local testing uses ADMOB_REWARD_DEV_MODE.
 *
 * https://developers.google.com/admob/android/ssv
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { config } from '../config.js';
import { log } from '../log.js';

const KEYS_TTL_MS = 6 * 60 * 60 * 1000;

export type SsvVerdict =
  | { ok: true; userId: string; transactionId: string; keyId: string }
  | { ok: false; reason: string };

interface VerifierKeyFile {
  keys?: Array<{ keyId?: number | string; pem?: string }>;
}

let cachedKeys: { fetchedAt: number; keys: Map<string, string> } | null = null;

export function splitSsvQuery(rawQuery: string): { content: string; params: URLSearchParams } | null {
  if (!rawQuery) return null;
  const embedded = rawQuery.lastIndexOf('&signature=');
  const cut = embedded >= 0 ? embedded : (rawQuery.startsWith('signature=') ? 0 : -1);
  if (cut < 0) return null;
  const content = rawQuery.slice(0, cut);
  if (!content) return null;
  return { content, params: new URLSearchParams(rawQuery) };
}

function signatureBuffers(signature: string): Buffer[] {
  const compact = signature.replace(/\s+/g, '');
  const out: Buffer[] = [];
  const push = (enc: BufferEncoding) => {
    try {
      const buf = Buffer.from(compact, enc);
      if (buf.length > 0) out.push(buf);
    } catch {
      // try the other alphabet
    }
  };
  push('base64url');
  push('base64');
  return out;
}

/** True when `signature` is a valid ECDSA-SHA256 signature over `content`. */
export function verifySsvContent(content: string, signature: string, pem: string): boolean {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    return false;
  }
  const payload = Buffer.from(content, 'utf8');
  for (const encoding of ['der', 'ieee-p1363'] as const) {
    for (const sig of signatureBuffers(signature)) {
      try {
        if (cryptoVerify('sha256', payload, { key, dsaEncoding: encoding }, sig)) return true;
      } catch {
        // wrong encoding for this key — try the next one
      }
    }
  }
  return false;
}

export async function loadAdmobVerifierKeys(
  fetcher: typeof fetch = fetch,
  url: string = config.admob.ssvKeysUrl,
): Promise<Map<string, string>> {
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`AdMob verifier keys HTTP ${res.status}`);
  }
  const body = (await res.json()) as VerifierKeyFile;
  const keys = new Map<string, string>();
  for (const entry of body.keys ?? []) {
    if (entry.keyId === undefined || !entry.pem) continue;
    keys.set(String(entry.keyId), entry.pem);
  }
  if (keys.size === 0) throw new Error('AdMob verifier key file contained no keys');
  return keys;
}

async function verifierKeys(force: boolean): Promise<Map<string, string>> {
  if (!force && cachedKeys && Date.now() - cachedKeys.fetchedAt < KEYS_TTL_MS) {
    return cachedKeys.keys;
  }
  const keys = await loadAdmobVerifierKeys();
  cachedKeys = { fetchedAt: Date.now(), keys };
  return keys;
}

export interface VerifySsvOptions {
  /** Injected keys skip the network fetch. Used by tests. */
  keys?: Map<string, string>;
}

/**
 * Verify one AdMob SSV query string.
 * Throws if the Google key file cannot be fetched (caller should 500 so
 * AdMob retries). A bad signature returns ok:false and must not grant scans.
 */
export async function verifyAdmobRewardQuery(rawQuery: string, opts: VerifySsvOptions = {}): Promise<SsvVerdict> {
  const parsed = splitSsvQuery(rawQuery);
  if (!parsed) return { ok: false, reason: 'missing_signature' };

  const userId = parsed.params.get('user_id') ?? '';
  const transactionId = parsed.params.get('transaction_id') ?? '';
  const keyId = parsed.params.get('key_id') ?? '';
  const signature = parsed.params.get('signature') ?? '';

  if (!userId || userId.length > 128 || userId.includes('/')) {
    return { ok: false, reason: 'bad_user' };
  }
  if (!transactionId || transactionId.length > 256 || transactionId.includes('/')) {
    return { ok: false, reason: 'bad_transaction' };
  }
  if (!keyId || !signature) return { ok: false, reason: 'missing_key' };

  let keys = opts.keys ?? await verifierKeys(false);
  let pem = keys.get(keyId);
  if (!pem && !opts.keys) {
    try {
      keys = await verifierKeys(true);
      pem = keys.get(keyId);
    } catch (e) {
      log.warn('admob.ssv_key_refresh_failed', {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (!pem) return { ok: false, reason: 'unknown_key' };
  if (!verifySsvContent(parsed.content, signature, pem)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, userId, transactionId, keyId };
}
