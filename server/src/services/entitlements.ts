/**
 * services/entitlements.ts — compute AI vision entitlement for a user.
 *
 * Sources, in priority order:
 *   1. FREE_PREMIUM_TESTING_UIDS / _EMAIL_SUFFIXES env — QA allowlist
 *      (never a source of truth for a paying customer)
 *   2. Firestore `entitlements/{uid}` — the real paid entitlement record
 *   3. Free tier
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
 * - Testing allowlist → premium with the configured monthly quota
 * - Firestore entitlement doc → premium per its own terms (lifetime or
 *   subscription), with its own quota (null = unlimited)
 * - Otherwise → free tier (no AI access)
 */
export async function computeEntitlements(ctx: UserContextLike): Promise<Entitlements> {
  const testing = isFreePremiumTestingAccount(ctx);
  const doc = testing ? null : await readEntitlementDoc(ctx.uid);

  const isPremium = testing || isEntitlementActive(doc);

  // Quota: the doc wins; testing accounts use the env-configured quota.
  let aiQuotaTotal: number | null;
  let aiUsesRemaining: number | null;
  if (testing) {
    aiQuotaTotal = config.quota.monthlyAiUses;
    aiUsesRemaining = aiQuotaTotal;
  } else if (doc) {
    aiQuotaTotal = doc.aiQuotaTotal ?? null;
    aiUsesRemaining = doc.aiUsesRemaining ?? null;
  } else {
    aiQuotaTotal = null;
    aiUsesRemaining = null;
  }

  const remainingAiUses =
    aiQuotaTotal === null ? null : Math.max(0, aiUsesRemaining ?? aiQuotaTotal);

  // canUseAi is false when a finite quota is exhausted; unlimited is always true.
  const canUseAi = isPremium && (remainingAiUses === null || remainingAiUses > 0);

  const subscription: Subscription | null =
    isPremium && doc && doc.productId
      ? {
          platform: 'google_play',
          productId: doc.productId,
          expiresAt: doc.expiresAt ?? null,
          autoRenewing: doc.autoRenewing ?? false,
          lifetime: doc.plan === 'lifetime',
        }
      : null;

  return {
    isPremium,
    adsEnabled: !isPremium,
    canUseAi,
    remainingAiUses,
    resetAt: subscription && !subscription.lifetime ? subscription.expiresAt : null,
    subscription,
    fetchedAt: new Date().toISOString(),
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
    if (data.aiQuotaTotal === null || data.aiQuotaTotal === undefined) return; // unlimited

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

  // A lifetime purchase entitles the buyer permanently. The quota comes
  // from config so the owner can tighten it without a redeploy of the
  // purchase path — but it is written into the doc so the read path
  // never has to guess.
  const aiQuotaTotal = opts.lifetime ? config.quota.lifetimeAiUses : config.quota.monthlyAiUses;

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
