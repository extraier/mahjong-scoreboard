/**
 * Decide what the camera tab should show.
 *
 * Lifetime (and any account with ads turned off) never sees the ad choice.
 * A free user who is out of scans sees the three-choice screen only once
 * we actually know the counter. While the counter is loading, or when it
 * could not be fetched, do not offer an ad — manual scoring stays available
 * and the server still enforces the limit.
 */

import type { Entitlements } from '../types/api';

export type VisionEntry = 'loading' | 'open' | 'choice';

export function decideVisionEntry(state: {
  loading: boolean;
  hasSnapshot: boolean;
  data: Entitlements;
}): VisionEntry {
  const e = state.data;
  if (e.isPremium) return 'open';
  if (!state.hasSnapshot && state.loading) return 'loading';
  // Ads are not offered until we know this is a free account. A failed
  // entitlements fetch leaves adsEnabled false so table play is not blocked
  // by an ad screen.
  if (!e.adsEnabled) return 'open';
  const remaining = e.remainingAiUses ?? 0;
  if (e.quotaKnown && e.canUseAi && (e.remainingAiUses === null || remaining > 0)) return 'open';
  if (e.quotaKnown && !e.canUseAi) return 'choice';
  return 'open';
}
