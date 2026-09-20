/**
 * vitest config — runs tests from server/tests/** using node environment
 * with tsx as the loader (matches our dev entry).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    globals: false,
    reporters: ['verbose'],
    // Seed the entitlements free-premium allowlist so `test-user` (the
    // fake uid minted by requireAuth under AUTH_MODE=test) is treated
    // as a premium testing account. Without this the entitlements
    // service returns isPremium=false and the /vision/* tests fail
    // with 403 AI_PREMIUM_REQUIRED before reaching their actual assertions.
    env: {
      ...process.env,
      AUTH_MODE: 'test',
      FREE_PREMIUM_TESTING_UIDS: process.env.FREE_PREMIUM_TESTING_UIDS ?? 'test-user,admin',
      FREE_PREMIUM_TESTING_EMAIL_SUFFIXES: process.env.FREE_PREMIUM_TESTING_EMAIL_SUFFIXES ?? '@test.local',
    },
  },
  resolve: {
    // Match src config — NodeNext ESM with explicit .js imports
    mainFields: ['module', 'main'],
  },
});
