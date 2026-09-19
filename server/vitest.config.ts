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
  },
  resolve: {
    // Match src config — NodeNext ESM with explicit .js imports
    mainFields: ['module', 'main'],
  },
});
