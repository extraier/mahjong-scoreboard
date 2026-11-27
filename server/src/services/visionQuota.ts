/**
 * Daily AI-vision quota.
 *
 * A "use" is one successful /api/vision/analyze. Reserving a slot and
 * refunding it (the photo was rejected, the provider failed, the player
 * retakes) does not count. Opening the camera never touches this module.
 *
 * Day boundary: 00:00 in Asia/Hong_Kong (UTC+8, no daylight-saving time).
 * Counters reset when the Hong Kong calendar day changes. Lifetime premium
 * does not use this counter — callers bypass it.
 *
 * Free allowance: 3 successful scans per day.
 * Each verified rewarded ad: +5 scans, at most 3 ads per day.
 */

export const QUOTA_TIMEZONE = 'Asia/Hong_Kong';

export interface QuotaPolicy {
  freeDailyScans: number;
  scansPerAd: number;
  maxAdsPerDay: number;
}

export const DEFAULT_QUOTA_POLICY: QuotaPolicy = {
  freeDailyScans: 3,
  scansPerAd: 5,
  maxAdsPerDay: 3,
};

export interface QuotaState {
  dayKey: string;
  successfulScans: number;
  adsWatched: number;
  bonusScans: number;
}

export interface QuotaView {
  dayKey: string;
  successfulScans: number;
  adsWatched: number;
  bonusScans: number;
  allowance: number;
  remaining: number;
  adsRemaining: number;
  /** ISO timestamp of the next 00:00 Asia/Hong_Kong. */
  resetAt: string;
}

export type QuotaMutationResult = 'ok' | 'rejected' | 'capped';

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((p) => p.type === type)?.value;
  if (!value) throw new Error(`missing date part ${type}`);
  return value;
}

/** `YYYY-MM-DD` in Asia/Hong_Kong. */
export function hongKongDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/**
 * Next 00:00 Asia/Hong_Kong, as an ISO string.
 * At exactly midnight the next boundary is 24 hours later — the reset
 * for the day that just started has already happened.
 */
export function nextHongKongMidnightIso(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  let hour = Number(part(parts, 'hour'));
  if (hour === 24) hour = 0;
  const minute = Number(part(parts, 'minute'));
  const second = Number(part(parts, 'second'));
  const elapsedMs = ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds();
  const dayMs = 24 * 60 * 60 * 1000;
  const remaining = dayMs - elapsedMs;
  return new Date(now.getTime() + (remaining === 0 ? dayMs : remaining)).toISOString();
}

function nonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

export function freshQuotaState(dayKey: string): QuotaState {
  return { dayKey, successfulScans: 0, adsWatched: 0, bonusScans: 0 };
}

/** Roll the stored counters forward when the Hong Kong day has changed. */
export function normalizeQuotaState(prev: QuotaState | null, now: Date): QuotaState {
  const dayKey = hongKongDayKey(now);
  if (!prev || prev.dayKey !== dayKey) return freshQuotaState(dayKey);
  return {
    dayKey,
    successfulScans: nonNeg(prev.successfulScans),
    adsWatched: nonNeg(prev.adsWatched),
    bonusScans: nonNeg(prev.bonusScans),
  };
}

export function toQuotaView(state: QuotaState, now: Date, policy: QuotaPolicy = DEFAULT_QUOTA_POLICY): QuotaView {
  const allowance = policy.freeDailyScans + state.bonusScans;
  return {
    ...state,
    allowance,
    remaining: Math.max(0, allowance - state.successfulScans),
    adsRemaining: Math.max(0, policy.maxAdsPerDay - state.adsWatched),
    resetAt: nextHongKongMidnightIso(now),
  };
}

export function viewFromStored(
  prev: QuotaState | null,
  now: Date,
  policy: QuotaPolicy = DEFAULT_QUOTA_POLICY,
): QuotaView {
  return toQuotaView(normalizeQuotaState(prev, now), now, policy);
}

/**
 * Apply one quota change to a (possibly stale-day) state.
 * `rejected` — no scans left; state is unchanged apart from a day roll.
 * `capped` — the 3-ad daily cap was already hit; no scans are added.
 */
export function applyQuotaMutation(
  prev: QuotaState | null,
  action: 'reserve' | 'refund' | 'grant_ad',
  now: Date,
  policy: QuotaPolicy = DEFAULT_QUOTA_POLICY,
): { state: QuotaState; result: QuotaMutationResult; view: QuotaView } {
  const state = normalizeQuotaState(prev, now);

  if (action === 'reserve') {
    const before = toQuotaView(state, now, policy);
    if (before.remaining <= 0) {
      return { state, result: 'rejected', view: before };
    }
    const next = { ...state, successfulScans: state.successfulScans + 1 };
    return { state: next, result: 'ok', view: toQuotaView(next, now, policy) };
  }

  if (action === 'refund') {
    const next = { ...state, successfulScans: Math.max(0, state.successfulScans - 1) };
    return { state: next, result: 'ok', view: toQuotaView(next, now, policy) };
  }

  if (state.adsWatched >= policy.maxAdsPerDay) {
    return { state, result: 'capped', view: toQuotaView(state, now, policy) };
  }
  const next = {
    ...state,
    adsWatched: state.adsWatched + 1,
    bonusScans: state.bonusScans + policy.scansPerAd,
  };
  return { state: next, result: 'ok', view: toQuotaView(next, now, policy) };
}
