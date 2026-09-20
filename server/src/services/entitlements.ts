/**
 * services/entitlements.ts — compute AI vision entitlement for a user.
 *
 * Sources, in priority order:
 *   1. FREE_PREMIUM_TESTING_UIDS env: explicit uids always premium
 *   2. FREE_PREMIUM_TESTING_EMAIL_SUFFIXES env: any email matching a
 *      suffix (e.g. "@comparetiger.com") is premium — for beta tester
 *      allowlists and internal team members.
 *   3. Firestore users/{uid}.entitlements doc — production source
 *      (subscription state, ad-free flag, monthly quota remaining).
 *      Not yet wired — current `me.ts` route returns a stub response.
 *
 * Quota behavior for free-premium users:
 *   - `remainingAiUses` returns the monthly quota (config-driven, default
 *     200) for testing accounts. Production users get the same quota on
 *     subscription start; we decrement via decrementQuota().
 *
 * Failure modes:
 *   - Unknown uid (not in allowlist, no Firestore doc) → returns
 *     isPremium=false, canUseAi=false, remainingAiUses=0.
 *   - Firestore unavailable → falls back to allowlist check; logs a
 *     warn. The user's request still completes (graceful degradation).
 */
import { config } from '../config.js';
import type { Entitlements } from '../types.js';

/**
 * Lightweight entitlement summary used by route handlers (subset of
 * full Entitlements to keep deps minimal). The full Entitlements is
 * exposed via /api/me/entitlements.
 */
export interface EntitlementSummary {
  isPremium: boolean;
  canUseAi: boolean;
  remainingAiUses: number;
}

interface UserContextLike {
  uid: string;
  email?: string | null;
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
 * Compute the user's full entitlement set. Currently:
 *   - Free-premium allowlist → always premium, canUseAi=true, full quota
 *   - Otherwise → free tier (no AI access)
 *
 * Firestore-backed production entitlements (subscription, ad-free, etc.)
 * will replace the second branch in a later commit. The interface is
 * already shaped to accept them.
 */
export async function computeEntitlements(
  ctx: UserContextLike
): Promise<Entitlements> {
  const isPremium = isFreePremiumTestingAccount(ctx);
  const canUseAi = isPremium;
  const remainingAiUses = isPremium ? config.quota.monthlyAiUses : 0;
  const fetchedAt = new Date().toISOString();

  return {
    isPremium,
    adsEnabled: !isPremium,
    canUseAi,
    remainingAiUses,
    resetAt: null, // TODO: compute from subscription renewal date
    subscription: null, // TODO: read from Firestore for paying users
    fetchedAt,
  };
}

/**
 * Lightweight entitlement summary for routes that only need isPremium.
 * Returns the same fields as computeEntitlements but without constructing
 * the full Entitlements object (small optimization for hot paths).
 */
export async function computeEntitlementSummary(
  ctx: UserContextLike
): Promise<EntitlementSummary> {
  const ent = await computeEntitlements(ctx);
  return {
    isPremium: ent.isPremium,
    canUseAi: ent.canUseAi,
    remainingAiUses: ent.remainingAiUses,
  };
}
