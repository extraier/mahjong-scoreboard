/**
 * entitlements.test.ts — verify the free-premium allowlist behavior.
 *
 * The entitlements service is the gatekeeper for:
 *   - POST /api/vision/analyze (premium required)
 *   - POST /api/vision/correct (premium required)
 *
 * Two allowlist paths:
 *   - FREE_PREMIUM_TESTING_UIDS: explicit uids
 *   - FREE_PREMIUM_TESTING_EMAIL_SUFFIXES: any email matching a suffix
 *
 * Without either, the user is free-tier (no AI access).
 *
 * Config is captured at module load, so each test calls vi.resetModules()
 * + dynamic re-import to pick up its env vars.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshEntitlements() {
  vi.resetModules();
  return import('../src/services/entitlements.js');
}

describe('entitlements', () => {
  beforeEach(() => {
    delete process.env.FREE_PREMIUM_TESTING_UIDS;
    delete process.env.FREE_PREMIUM_TESTING_EMAIL_SUFFIXES;
    vi.resetModules();
  });

  it('uid in FREE_PREMIUM_TESTING_UIDS → isPremium=true', async () => {
    process.env.FREE_PREMIUM_TESTING_UIDS = 'beta-tester,another';
    const { isFreePremiumTestingAccount } = await freshEntitlements();
    expect(isFreePremiumTestingAccount({ uid: 'beta-tester' })).toBe(true);
    expect(isFreePremiumTestingAccount({ uid: 'another' })).toBe(true);
    expect(isFreePremiumTestingAccount({ uid: 'random-user' })).toBe(false);
  });

  it('email in FREE_PREMIUM_TESTING_EMAIL_SUFFIXES → isPremium=true', async () => {
    process.env.FREE_PREMIUM_TESTING_EMAIL_SUFFIXES = '@comparetiger.com,@beta.local';
    const { isFreePremiumTestingAccount } = await freshEntitlements();
    expect(isFreePremiumTestingAccount({ uid: 'x', email: 'alice@comparetiger.com' })).toBe(true);
    expect(isFreePremiumTestingAccount({ uid: 'x', email: 'bob@beta.local' })).toBe(true);
    expect(isFreePremiumTestingAccount({ uid: 'x', email: 'eve@gmail.com' })).toBe(false);
  });

  it('email suffix match is case-insensitive', async () => {
    process.env.FREE_PREMIUM_TESTING_EMAIL_SUFFIXES = '@CompareTiger.com';
    const { isFreePremiumTestingAccount } = await freshEntitlements();
    expect(isFreePremiumTestingAccount({ uid: 'x', email: 'Alice@COMPARETIGER.COM' })).toBe(true);
  });

  it('empty env vars + unknown uid → isPremium=false', async () => {
    const { isFreePremiumTestingAccount } = await freshEntitlements();
    expect(isFreePremiumTestingAccount({ uid: 'some-user' })).toBe(false);
    expect(isFreePremiumTestingAccount({ uid: 'some-user', email: 'x@gmail.com' })).toBe(false);
  });

  it('computeEntitlements returns full Premium set for testing uids', async () => {
    process.env.FREE_PREMIUM_TESTING_UIDS = 'tester';
    const { computeEntitlements } = await freshEntitlements();
    const ent = await computeEntitlements({ uid: 'tester' });
    expect(ent).toMatchObject({
      isPremium: true,
      canUseAi: true,
      adsEnabled: false,
    });
    expect(ent.remainingAiUses).toBeGreaterThan(0);
    expect(ent.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('computeEntitlements returns free-tier for unknown uid', async () => {
    const { computeEntitlements } = await freshEntitlements();
    const ent = await computeEntitlements({ uid: 'random-unknown-user' });
    expect(ent).toMatchObject({
      isPremium: false,
      canUseAi: false,
      adsEnabled: true,
      remainingAiUses: 0,
    });
  });
});
