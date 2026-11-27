/**
 * Shown when a free user is out of successful vision scans and taps the
 * camera. Exactly three choices. Nothing here plays an ad by itself —
 * the watch button is the only way an ad starts, and only after the tap.
 *
 * Lifetime accounts must not render this. The parent also skips it when
 * adsEnabled is false; the guard below is a second check.
 */

import { useState } from 'react';

export interface VisionAccessSheetProps {
  adsEnabled: boolean;
  adsRemainingToday: number | null;
  onRewardGranted: (remainingAiUses: number | null) => void;
  onUnlock: () => void;
  onManual: () => void;
}

export function VisionAccessSheet({
  adsEnabled,
  adsRemainingToday,
  onRewardGranted,
  onUnlock,
  onManual,
}: VisionAccessSheetProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const adsLeft = adsRemainingToday ?? 0;
  const adsCapped = adsLeft <= 0;

  if (!adsEnabled) return null;

  const watch = async () => {
    if (busy || adsCapped) return;
    setBusy(true);
    setMessage(null);
    try {
      const { watchRewardedAdForScans } = await import('../lib/rewardedAdClient');
      const result = await watchRewardedAdForScans({ previousRemaining: 0 });
      if ('message' in result) {
        setMessage(result.message);
        return;
      }
      onRewardGranted(result.remainingAiUses);
    } catch {
      setMessage('廣告暫時播唔到。你可以手動入牌，或者一次過解鎖。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bg-white border border-emerald-100 rounded-[2rem] p-5 space-y-3 shadow-sm"
      role="region"
      aria-label="今日識別次數用完"
    >
      <div className="text-center space-y-1">
        <h3 className="text-lg font-black text-emerald-950">今日 AI 識別次數用完</h3>
        <p className="text-xs text-emerald-800/80 leading-relaxed">
          每日有 3 次成功識別。睇一段約 15–30 秒短片可以再加 5 次，每日最多 3 次。手動計分一直免費。
        </p>
      </div>

      <button
        type="button"
        onClick={watch}
        disabled={busy || adsCapped}
        className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy
          ? '廣告播放中…'
          : adsCapped
            ? '今日廣告次數已用完（聽日零點重置）'
            : `睇短片廣告，加 5 次識別（今日仲有 ${adsLeft} 次）`}
      </button>

      <button
        type="button"
        onClick={onUnlock}
        disabled={busy}
        className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl font-black text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60"
      >
        HK$38 永久無限識別
      </button>

      <button
        type="button"
        onClick={onManual}
        className="w-full py-3 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-2xl font-black text-sm"
      >
        改為手動入牌
      </button>

      {message && (
        <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-2" role="status">
          {message}
        </p>
      )}
      <p className="text-[10px] text-emerald-800/60 text-center">
        廣告唔會自動播放，計分同結算期間亦唔會出現。
      </p>
    </div>
  );
}
