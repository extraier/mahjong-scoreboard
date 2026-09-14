/**
 * AdBanner — controlled by server-source-of-truth `adsEnabled`.
 *
 * Per spec §8: 'premium entitlement 載入完成且 isPremium === true 時，完全不 mount ad view'
 * 'entitlement loading 未完成時，寧願先不顯示 ad'.
 *
 * Pure web Phase 1: renders a placeholder labeled 'AdMob banner (Phase 4)'
 * so reviewers can see the wiring works. Phase 4 wires the real @capacitor-
 * community/admob plugin. NEVER derives `enabled` from localStorage or any
 * user-mutable signal — server entitlement is the only source of truth.
 */

import type { Entitlements } from '../types/api';

export interface AdBannerProps {
  entitlements: Entitlements;
  /** Optional placement id for analytics; not used in Phase 1 */
  placement?: string;
}

export function AdBanner({ entitlements, placement = 'scoreboard_bottom' }: AdBannerProps) {
  // Loading state → show nothing. NEVER show an ad while we don't yet
  // know if the user is premium (spec §8 entitlement-loading rule).
  if (!entitlements.fetchedAt || entitlements.fetchedAt.startsWith('1970')) return null;
  // Premium user → no ad ever.
  if (!entitlements.adsEnabled) return null;
  // Default ad disabled → don't render
  if (entitlements.isPremium) return null;

  return (
    <div
      className="bg-emerald-900/10 border border-dashed border-emerald-900/30 rounded-xl text-center py-3 px-4 my-2"
      aria-label="廣告位置 (Phase 1 placeholder, Phase 4 wires AdMob)"
      data-ad-placement={placement}
    >
      <p className="text-[10px] font-bold text-emerald-900/70 uppercase tracking-widest">
        廣告位置
      </p>
      <p className="text-[10px] text-emerald-900/50 mt-0.5">
        Phase 1 · Phase 4 將改為 AdMob banner
      </p>
    </div>
  );
}
