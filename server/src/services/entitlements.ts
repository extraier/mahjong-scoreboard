/**
 * services/entitlements.ts — compute AI vision entitlement for a user.
 *
 * Sources, in priority order:
 *   1. FREE_PREMIUM_TESTING_UIDS / _EMAIL_SUFFIXES env — QA allowlist
 *      (never a source of truth for a paying customer)
 *   2. Firestore `entitlements/{uid}` — the real paid entitlement record
 *   3. Free tier — 3 successful vision scans per Asia/Hong_Kong day,
 *      plus up to 3 rewarded ads (+5 scans each). See visionQuota.ts.
 *
 * Entitlement doc shape (Firestore `entitlements/{uid}`):
 *   {
 *     email: string,
 *     plan: 'lifetime' | 'subscription',
 *     productId: string,            // e.g. 'premium_lifetime'
 *     purchasedAt: ISO string,
 *     expiresAt: ISO string | null, // null => lifetime, never expires
 *     autoRenewing: boolean,
 *     aiQuotaTotal: number | null,  // null => unlimited
 *     aiUsesRemaining: number | null,
 *     updatedAt: ISO string,
 *   }
 *
 * The client NEVER writes here — the Admin SDK bypasses Firestore rules.
 * The rules file denies client read/write on `entitlements/*`; the app
 * reads entitlements through GET /api/me/entitlements instead.
 *
 * Quota semantics: `remainingAiUses === null` means UNLIMITED. The
 * frontend type comment says exactly this ("null if no quota system").
 * A numeric value is a finite remaining count.
 */

import { getFirebase } from '../firebase.js';
import { config } from '../config.js';
import { log } from '../log.js';
import type { Entitlements, Subscription } from '../types.js';
import { tryReadDailyQuota } from './visionQuotaStore.js';

export interface UserContextLike {
  uid: string;
  email?: string | null;
}

/**
 * Lightweight entitlement summary used by route handlers (subset of
 * full Entitlements to keep deps minimal).
 */
export interface EntitlementSummary {
  isPremium: boolean;
  canUseAi: boolean;
  remainingAiUses: number | null;
  /**
   * Lifetime, the QA allowlist, and any paid finite counter skip the
   * free daily bucket. Free users are the only daily-quota accounts.
   */
  bypassDailyQuota: boolean;
  resetAt: string | null;
  adsRemainingToday: number | null;
}

export interface EntitlementDoc {
  email?: string;
  plan?: 'lifetime' | 'subscription' | string;
  productId?: string;
  purchasedAt?: string;
  expiresAt?: string | null;
  autoRenewing?: boolean;
  aiQuotaTotal?: number | null;
  aiUsesRemaining?: number | null;
  updatedAt?: string;
}

/**
 * Synchronous allowlist check (no Firestore needed). Cheap enough to
 * run on every request.
 */
export function isFreePremiumTestingAccount(ctx: UserContextLike): boolean {
  if (config.freePremium.testingUids.includes(ctx.uid)) return true;
  if (ctx.email) {
    for (const suffix of config.freePremium.testingEmailSuffixes) {
      if (ctx.email.toLowerCase().endsWith(suffix.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Read the user's entitlement doc. Returns null when there is no doc,
 * or when Firestore is unreachable (graceful degradation to free tier —
 * a transient DB outage must not crash the request).
 */
export async function readEntitlementDoc(uid: string): Promise<EntitlementDoc | null> {
  try {
    const { firestore } = getFirebase();
    const snap = await firestore.collection('entitlements').doc(uid).get();
    if (!snap.exists) return null;
    return snap.data() as EntitlementDoc;
  } catch (e) {
    log.warn('entitlements.read_failed', {
      uid,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Is this entitlement still valid? A lifetime plan never expires; a
 * subscription expires at `expiresAt`.
 */
export function isEntitlementActive(doc: EntitlementDoc | null): boolean {
  if (!doc) return false;
  if (doc.plan !== 'lifetime' && doc.plan !== 'subscription') return false;
  if (!doc.expiresAt) return doc.plan === 'lifetime';
  const t = new Date(doc.expiresAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/**
 * Compute the user's full entitlement set.
 *
 * - Active lifetime purchase → unlimited vision, ads never offered.
 *   A numeric aiQuotaTotal left by an older build (the previous 2,000 cap)
 *   is ignored.
 * - Testing allowlist → premium with the configured monthly quota, no ads.
 *   A paying customer's doc wins over the allowlist.
 * - Other active paid docs → that doc's own finite counter, no ads.
 * - Otherwise → free daily bucket (3 successful scans, reset 00:00
 *   Asia/Hong_Kong). If the counter cannot be read, quotaKnown is false
 *   and canUseAi is false so an outage is not treated as unlimited.
 */
export async function computeEntitlements(ctx: UserContextLike): Promise<Entitlements> {
  // Always read the doc. The testing allowlist is a FALLBACK for
  // premium, not an override — a paying customer who also matches an
  // allowlist suffix must still get their purchased lifetime entitlement,
  // not the smaller testing quota.
  const doc = await readEntitlementDoc(ctx.uid);
  const hasPaidEntitlement = isEntitlementActive(doc);
  const testing = !hasPaidEntitlement && isFreePremiumTestingAccount(ctx);
  const isPremium = hasPaidEntitlement || testing;
  const lifetime = hasPaidEntitlement && doc?.plan === 'lifetime';
  const fetchedAt = new Date().toISOString();

  if (!isPremium) {
    const daily = await tryReadDailyQuota(ctx.uid);
    if (!daily) {
      return {
        isPremium: false,
        adsEnabled: true,
        canUseAi: false,
        remainingAiUses: 0,
        resetAt: null,
        subscription: null,
        fetchedAt,
        quotaKnown: false,
        adsRemainingToday: null,
      };
    }
    return {
      isPremium: false,
      adsEnabled: true,
      canUseAi: daily.remaining > 0,
      remainingAiUses: daily.remaining,
      resetAt: daily.resetAt,
      subscription: null,
      fetchedAt,
      quotaKnown: true,
      adsRemainingToday: daily.adsRemaining,
    };
  }

  // Lifetime is unlimited. Testing accounts keep the env monthly number.
  // Any other paid doc keeps the counter stored on the entitlement.
  let aiQuotaTotal: number | null;
  let aiUsesRemaining: number | null;
  if (lifetime) {
    aiQuotaTotal = null;
    aiUsesRemaining = null;
  } else if (hasPaidEntitlement && doc) {
    aiQuotaTotal = doc.aiQuotaTotal ?? null;
    aiUsesRemaining = doc.aiUsesRemaining ?? null;
  } else {
    aiQuotaTotal = config.quota.monthlyAiUses;
    aiUsesRemaining = aiQuotaTotal;
  }

  const remainingAiUses =
    aiQuotaTotal === null ? null : Math.max(0, aiUsesRemaining ?? aiQuotaTotal);
  const canUseAi = remainingAiUses === null || remainingAiUses > 0;

  const subscription: Subscription | null =
    doc && doc.productId
      ? {
          platform: 'google_play',
          productId: doc.productId,
          expiresAt: doc.expiresAt ?? null,
          autoRenewing: doc.autoRenewing ?? false,
          lifetime: doc.plan === 'lifetime',
        }
      : null;

  return {
    isPremium: true,
    adsEnabled: false,
    canUseAi,
    remainingAiUses,
    resetAt: subscription && !subscription.lifetime ? subscription.expiresAt : null,
    subscription,
    fetchedAt,
    quotaKnown: true,
    adsRemainingToday: null,
  };
}

/**
 * Lightweight entitlement summary for routes that only need the
 * premium flag. Same fields as computeEntitlements without building
 * the full object (small optimization for hot paths).
 */
export async function computeEntitlementSummary(
  ctx: UserContextLike,
): Promise<EntitlementSummary> {
  const ent = await computeEntitlements(ctx);
  return {
    isPremium: ent.isPremium,
    canUseAi: ent.canUseAi,
    remainingAiUses: ent.remainingAiUses,
    bypassDailyQuota: ent.isPremium,
    resetAt: ent.resetAt,
    adsRemainingToday: ent.adsRemainingToday,
  };
}

/**
 * Decrement the user's finite AI quota after a successful vision call.
 * No-op for unlimited (aiQuotaTotal === null) entitlements and for
 * testing accounts, whose quota is recomputed from config each time.
 */
export async function decrementQuota(uid: string): Promise<void> {
  try {
    const { firestore } = getFirebase();
    const docRef = firestore.collection('entitlements').doc(uid);
    const snap = await docRef.get();
    if (!snap.exists) return;
    const data = snap.data() as EntitlementDoc;
    // Lifetime is unlimited even when an older doc still stores a number.
    if (data.plan === 'lifetime') return;
    if (data.aiQuotaTotal === null || data.aiQuotaTotal === undefined) return;

    await docRef.set(
      {
        aiUsesRemaining: Math.max(0, (data.aiUsesRemaining ?? data.aiQuotaTotal) - 1),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (e) {
    // A failed decrement must never fail the user's successful vision call.
    log.warn('entitlements.decrement_failed', {
      uid,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Grant (or refresh) a paid entitlement. Called by the purchase
 * verification path after Google Play confirms a purchase.
 *
 * @param uid       Firebase Auth uid of the buyer
 * @param email     Buyer's email (informational)
 * @param productId Play product id, e.g. 'premium_lifetime'
 * @param lifetime  true for a one-time purchase, false for a subscription
 * @param expiresAt ISO expiry for subscriptions; null for lifetime
 */
export async function grantEntitlement(opts: {
  uid: string;
  email?: string | null;
  productId: string;
  lifetime: boolean;
  expiresAt?: string | null;
  autoRenewing?: boolean;
  purchaseToken?: string;
}): Promise<void> {
  const { firestore } = getFirebase();
  const now = new Date().toISOString();

  // Lifetime is unlimited (null). A non-lifetime grant keeps the monthly
  // counter. This path does not create subscriptions; it only records
  // whatever Play already verified.
  const aiQuotaTotal = opts.lifetime ? null : config.quota.monthlyAiUses;

  const payload: Record<string, unknown> = {
    email: opts.email ?? null,
    plan: opts.lifetime ? 'lifetime' : 'subscription',
    productId: opts.productId,
    purchasedAt: now,
    expiresAt: opts.lifetime ? null : opts.expiresAt ?? null,
    autoRenewing: opts.autoRenewing ?? false,
    aiQuotaTotal,
    aiUsesRemaining: aiQuotaTotal,
    updatedAt: now,
  };
  if (opts.purchaseToken) payload.purchaseToken = opts.purchaseToken;

  await firestore.collection('entitlements').doc(opts.uid).set(payload, { merge: true });
  log.info('entitlements.granted', { uid: opts.uid, productId: opts.productId, lifetime: opts.lifetime });
}
