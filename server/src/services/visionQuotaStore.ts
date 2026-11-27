/**
 * Persistence for the daily vision quota.
 *
 * Production uses Firestore (`vision_quota/{uid}`, `ad_reward_events/{id}`).
 * Tests use the in-memory gate. Both apply the same pure transitions from
 * visionQuota.ts, so a day roll, a refund, and the ad cap cannot drift
 * between the two.
 *
 * The client cannot write these collections (firestore.rules denies them).
 */

import { getFirebase } from '../firebase.js';
import { config } from '../config.js';
import { log } from '../log.js';
import {
  applyQuotaMutation,
  viewFromStored,
  type QuotaPolicy,
  type QuotaState,
  type QuotaView,
} from './visionQuota.js';

export interface AdGrantResult {
  granted: boolean;
  duplicate: boolean;
  capped: boolean;
  view: QuotaView;
}

export interface QuotaGate {
  read(uid: string, now?: Date): Promise<QuotaView>;
  /** Take one scan. Throws QuotaRejectedError when none remain. */
  reserve(uid: string, now?: Date): Promise<QuotaView>;
  /** Give back a scan reserved for an analyze that did not succeed. */
  refund(uid: string, now?: Date): Promise<QuotaView>;
  /**
   * Credit one rewarded ad (+5 scans) unless today's 3-ad cap is hit.
   * A repeated transactionId is a no-op (AdMob retries the SSV callback).
   * Pass null from the dev-only claim, which has no AdMob transaction.
   */
  grantAd(uid: string, transactionId: string | null, now?: Date): Promise<AdGrantResult>;
}

export class QuotaRejectedError extends Error {
  readonly view: QuotaView;
  constructor(view: QuotaView) {
    super('daily vision quota exceeded');
    this.name = 'QuotaRejectedError';
    this.view = view;
  }
}

function policyFromConfig(): QuotaPolicy {
  return {
    freeDailyScans: config.visionQuota.freeDailyScans,
    scansPerAd: config.visionQuota.scansPerAd,
    maxAdsPerDay: config.visionQuota.maxAdsPerDay,
  };
}

function serialize(state: QuotaState, now: Date): Record<string, unknown> {
  return {
    dayKey: state.dayKey,
    successfulScans: state.successfulScans,
    adsWatched: state.adsWatched,
    bonusScans: state.bonusScans,
    timezone: 'Asia/Hong_Kong',
    updatedAt: now.toISOString(),
  };
}

function parseState(data: Record<string, unknown> | undefined): QuotaState | null {
  if (!data || typeof data.dayKey !== 'string') return null;
  return {
    dayKey: data.dayKey,
    successfulScans: Number(data.successfulScans ?? 0),
    adsWatched: Number(data.adsWatched ?? 0),
    bonusScans: Number(data.bonusScans ?? 0),
  };
}

/**
 * In-memory gate. A per-uid queue keeps reserve/refund/grant ordered so
 * tests can simulate overlapping analyzes.
 */
export function createMemoryQuotaGate(
  policy: QuotaPolicy = policyFromConfig(),
  now: () => Date = () => new Date(),
): QuotaGate {
  const states = new Map<string, QuotaState>();
  const seenTransactions = new Set<string>();
  const tails = new Map<string, Promise<unknown>>();

  function locked<T>(uid: string, fn: () => T): Promise<T> {
    const prev = tails.get(uid) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(uid, run.then(() => undefined, () => undefined));
    return run;
  }

  return {
    read(uid, at = now()) {
      return locked(uid, () => viewFromStored(states.get(uid) ?? null, at, policy));
    },
    reserve(uid, at = now()) {
      return locked(uid, () => {
        const applied = applyQuotaMutation(states.get(uid) ?? null, 'reserve', at, policy);
        if (applied.result === 'rejected') throw new QuotaRejectedError(applied.view);
        states.set(uid, applied.state);
        return applied.view;
      });
    },
    refund(uid, at = now()) {
      return locked(uid, () => {
        const applied = applyQuotaMutation(states.get(uid) ?? null, 'refund', at, policy);
        states.set(uid, applied.state);
        return applied.view;
      });
    },
    grantAd(uid, transactionId, at = now()) {
      return locked(uid, () => {
        if (transactionId && seenTransactions.has(transactionId)) {
          return {
            granted: false,
            duplicate: true,
            capped: false,
            view: viewFromStored(states.get(uid) ?? null, at, policy),
          };
        }
        const applied = applyQuotaMutation(states.get(uid) ?? null, 'grant_ad', at, policy);
        if (transactionId) seenTransactions.add(transactionId);
        states.set(uid, applied.state);
        return {
          granted: applied.result === 'ok',
          duplicate: false,
          capped: applied.result === 'capped',
          view: applied.view,
        };
      });
    },
  };
}

function firestoreGate(): QuotaGate {
  const policy = () => policyFromConfig();

  return {
    async read(uid, at = new Date()) {
      const { firestore } = getFirebase();
      const snap = await firestore.collection('vision_quota').doc(uid).get();
      const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
      return viewFromStored(parseState(data), at, policy());
    },

    async reserve(uid, at = new Date()) {
      const { firestore } = getFirebase();
      const ref = firestore.collection('vision_quota').doc(uid);
      const view = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? parseState(snap.data() as Record<string, unknown>) : null;
        const applied = applyQuotaMutation(prev, 'reserve', at, policy());
        if (applied.result === 'rejected') return { rejected: true as const, view: applied.view };
        tx.set(ref, serialize(applied.state, at), { merge: true });
        return { rejected: false as const, view: applied.view };
      });
      if (view.rejected) throw new QuotaRejectedError(view.view);
      return view.view;
    },

    async refund(uid, at = new Date()) {
      const { firestore } = getFirebase();
      const ref = firestore.collection('vision_quota').doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? parseState(snap.data() as Record<string, unknown>) : null;
        const applied = applyQuotaMutation(prev, 'refund', at, policy());
        tx.set(ref, serialize(applied.state, at), { merge: true });
        return applied.view;
      });
    },

    async grantAd(uid, transactionId, at = new Date()) {
      const { firestore } = getFirebase();
      const quotaRef = firestore.collection('vision_quota').doc(uid);
      const eventRef = transactionId
        ? firestore.collection('ad_reward_events').doc(transactionId)
        : null;

      return firestore.runTransaction(async (tx) => {
        const eventSnap = eventRef ? await tx.get(eventRef) : null;
        const quotaSnap = await tx.get(quotaRef);
        const prev = quotaSnap.exists ? parseState(quotaSnap.data() as Record<string, unknown>) : null;
        if (eventSnap?.exists) {
          return {
            granted: false,
            duplicate: true,
            capped: false,
            view: viewFromStored(prev, at, policy()),
          };
        }
        const applied = applyQuotaMutation(prev, 'grant_ad', at, policy());
        if (eventRef) {
          tx.set(eventRef, {
            uid,
            result: applied.result,
            createdAt: at.toISOString(),
          });
        }
        if (applied.result === 'ok') {
          tx.set(quotaRef, serialize(applied.state, at), { merge: true });
        }
        return {
          granted: applied.result === 'ok',
          duplicate: false,
          capped: applied.result === 'capped',
          view: applied.view,
        };
      });
    },
  };
}

const productionGate = firestoreGate();

export function readDailyQuota(uid: string): Promise<QuotaView> {
  return productionGate.read(uid);
}

export function reserveDailyScan(uid: string): Promise<QuotaView> {
  return productionGate.reserve(uid);
}

export function refundDailyScan(uid: string): Promise<QuotaView> {
  return productionGate.refund(uid);
}

export function grantRewardedScans(uid: string, transactionId: string | null): Promise<AdGrantResult> {
  return productionGate.grantAd(uid, transactionId);
}

/** Read helper for entitlements. A Firestore outage returns null (fail closed). */
export async function tryReadDailyQuota(uid: string): Promise<QuotaView | null> {
  try {
    return await readDailyQuota(uid);
  } catch (e) {
    log.warn('vision_quota.read_failed', {
      uid,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
