/**
 * stubProvider.ts — canned mahjong vision result for offline dev,
 * unit tests, and as the default fallback when MINIMAX_API_KEY is unset.
 *
 * Spec §3 compliance note: this provider is selected at server boot
 * ONLY IF config.visionConfigured === false. There is no runtime path
 * that allows a non-premium client to force this provider — they get
 * 403 AI_PREMIUM_REQUIRED before the vision layer is even consulted.
 *
 * What it returns: a fixed 13-tile east-wind hand and one "uncertain"
 * marker, so the frontend's <AiCameraPanel> can exercise the
 * "uncertain tile inline editor" UI path during local dev.
 */

import type { MahjongVisionResult } from '../types.js';
import type { VisionInput, VisionProvider } from './visionProvider.js';

const STUB_HAND: MahjongVisionResult = {
  tiles: ['W1', 'W2', 'W3', 'W4', 'T5', 'T6', 'T7', 'S8', 'S9', 'S2', 'S3', 'F4', 'F6'],
  flowers: [],
  uncertainTiles: [
    { index: 4, reason: 'Tile partially occluded by other tile in test fixture' },
  ],
  confidence: 0.42,
  notes: ['stub provider — set MINIMAX_API_KEY to enable real vision inference'],
};

export interface StubProviderOptions {
  /** Simulate latency in ms — useful for testing the loading state in UI */
  delayMs?: number;
  /** Inject deterministic tiles instead of the canned hand (for fixture-driven tests) */
  override?: Partial<MahjongVisionResult>;
}

export function createStubProvider(opts: StubProviderOptions = {}): VisionProvider {
  return {
    name: 'stub',
    async analyze(_input: VisionInput): Promise<MahjongVisionResult> {
      if (opts.delayMs && opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return { ...STUB_HAND, ...opts.override, notes: [...STUB_HAND.notes] };
    },
  };
}
