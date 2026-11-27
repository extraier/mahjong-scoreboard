/**
 * Opt-in rewarded video.
 *
 * Nothing here runs until the user taps "watch an ad". The AdMob plugin
 * is loaded on that tap, not at app start, so scoring and settlement never
 * initialize ads.
 *
 * Dev / test ads do not fire AdMob server-side verification. After the
 * video rewards the user, the client asks POST /api/ads/reward/dev-claim.
 * Production servers answer 404 (the route is disabled when NODE_ENV is
 * production) and the client then polls until a verified SSV callback
 * credits the scans. A client cannot grant itself scans against production.
 */

import { Capacitor } from '@capacitor/core';
import { getAuthToken, getCurrentUid } from './authClient';
import { request } from './apiClient';
import { getEntitlements } from './entitlementClient';

/** Google's official Android rewarded test unit. Not a production unit. */
export const GOOGLE_TEST_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

export interface DevClaimResponse {
  ok: boolean;
  granted: boolean;
  capped?: boolean;
  duplicate?: boolean;
  remainingAiUses?: number | null;
  adsRemainingToday?: number | null;
  resetAt?: string | null;
  reason?: string;
}

export type WatchRewardResult =
  | { ok: true; remainingAiUses: number | null }
  | { ok: false; message: string };

function productionUnitId(): string {
  return (import.meta.env.VITE_ADMOB_REWARDED_UNIT_ID ?? '').trim();
}

export function rewardedAdUnitId(): string {
  return productionUnitId() || GOOGLE_TEST_REWARDED_AD_UNIT_ID;
}

function usingTestAdUnit(): boolean {
  return productionUnitId() === '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimDevReward(): Promise<
  | { kind: 'granted'; remaining: number | null }
  | { kind: 'capped'; message: string }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }
> {
  const r = await request<DevClaimResponse>('/api/ads/reward/dev-claim', { method: 'POST' });
  if (r.ok === false) {
    if (r.error.status === 404) return { kind: 'disabled' };
    return { kind: 'error', message: r.error.message || '暫時未能入賬廣告獎勵。' };
  }
  if (r.data.granted) {
    return { kind: 'granted', remaining: r.data.remainingAiUses ?? null };
  }
  if (r.data.capped) {
    return { kind: 'capped', message: '今日廣告次數已用完，聽日香港時間零點先可以再睇。' };
  }
  if (r.data.reason === 'not_applicable') {
    return { kind: 'granted', remaining: null };
  }
  return { kind: 'error', message: '廣告獎勵未入賬，請稍後再試。' };
}

async function pollForGrant(previousRemaining: number): Promise<number | null | undefined> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const ent = await getEntitlements();
      if (ent.remainingAiUses === null) return null;
      if (ent.quotaKnown && (ent.remainingAiUses ?? 0) > previousRemaining) {
        return ent.remainingAiUses;
      }
    } catch {
      // Keep polling. A dropped response is not a reason to play another ad.
    }
  }
  return undefined;
}

/**
 * Play one rewarded video, then wait until the server has credited scans.
 * On the web mock (`VITE_USE_MOCK_BACKEND=1`) there is no AdMob SDK, so the
 * button credits a dev reward without a video. That path is not compiled
 * into a store build unless the mock flag is set.
 */
export async function watchRewardedAdForScans(opts: {
  previousRemaining: number;
}): Promise<WatchRewardResult> {
  const mock = import.meta.env.VITE_USE_MOCK_BACKEND === '1';

  if (!Capacitor.isNativePlatform()) {
    if (!mock) {
      return {
        ok: false,
        message: '獎勵廣告只可以喺 Android App 度播放。你可以手動入牌，或者一次過解鎖無限識別。',
      };
    }
    const claimed = await claimDevReward();
    if (claimed.kind === 'granted') return { ok: true, remainingAiUses: claimed.remaining };
    if (claimed.kind === 'capped') return { ok: false, message: claimed.message };
    return { ok: false, message: claimed.kind === 'error' ? claimed.message : '開發用獎勵未開通。' };
  }

  const token = await getAuthToken();
  const uid = getCurrentUid();
  if (!token || !uid) {
    return { ok: false, message: '請先喺「設定」登入，廣告獎勵先可以入到你嘅帳戶。' };
  }

  const adId = rewardedAdUnitId();
  const isTesting = usingTestAdUnit();
  const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');

  await AdMob.initialize({ initializeForTesting: isTesting });

  let rewarded = false;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  let resolveDismissed: () => void = () => undefined;
  const dismissed = new Promise<void>((resolve) => {
    resolveDismissed = resolve;
  });
  handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resolveDismissed()));

  try {
    await AdMob.prepareRewardVideoAd({
      adId,
      isTesting,
      ssv: { userId: uid },
    });

    const shown = AdMob.showRewardVideoAd().then((item) => {
      rewarded = true;
      return item;
    });

    // The plugin resolves showRewardVideoAd only when the user earns the
    // reward. Dismissing early never resolves that promise, so race it.
    const outcome = await Promise.race([
      shown.then(() => 'reward' as const),
      dismissed.then(() => 'dismiss' as const),
      sleep(120_000).then(() => 'timeout' as const),
    ]);

    if (outcome !== 'reward') {
      await Promise.race([shown.catch(() => undefined), sleep(400)]);
    }
    if (!rewarded) {
      return { ok: false, message: '未睇完廣告，次數冇增加。' };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : '';
    return {
      ok: false,
      message: detail
        ? `廣告暫時播唔到（${detail}）。你可以手動入牌，或者一次過解鎖。`
        : '廣告暫時播唔到。你可以手動入牌，或者一次過解鎖。',
    };
  } finally {
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
  }

  const claimed = await claimDevReward();
  if (claimed.kind === 'granted') return { ok: true, remainingAiUses: claimed.remaining };
  if (claimed.kind === 'capped') return { ok: false, message: claimed.message };
  if (claimed.kind === 'error') return { ok: false, message: claimed.message };

  const polled = await pollForGrant(opts.previousRemaining);
  if (polled !== undefined) return { ok: true, remainingAiUses: polled };
  return {
    ok: false,
    message: '廣告已播完，但伺服器未確認獎勵。請等一陣再入嚟。次數由伺服器入賬，唔會因為你重試而重複扣。',
  };
}
