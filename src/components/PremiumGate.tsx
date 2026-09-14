/**
 * PremiumGate — wraps premium-only feature affordance.
 *
 * Per spec §9: '免費用戶按 AI 拍照 → App 顯示升級畫面 + 利益 + CTA.
 *               完成登入後回到原本 screen'.
 *
 * The component is purely presentational; the caller's `enabled` boolean
 * already reflects `entitlements.canUseAi`. The gate renders:
 *   - enabled: children directly
 *   - disabled: opaque card with CTA → triggers onUpgrade() handler
 */

import type { ReactNode } from 'react';

export interface PremiumGateProps {
  /** True when the user is entitled to use the gated feature */
  enabled: boolean;
  /** Loading state — disables CTA and shows spinner */
  loading?: boolean;
  /** Short headline on the locked card, e.g. '升級解鎖 AI 識別' */
  title?: string;
  /** Benefit list, one item per line */
  benefits?: string[];
  /** CTA button label, e.g. '升級至 PRO' */
  ctaLabel?: string;
  /** Called when the user taps CTA. Phase 1: no-op with banner; Phase 3: launches Billing */
  onUpgrade?: () => void;
  /** The actual feature UI */
  children: ReactNode;
}

const DEFAULT_BENEFITS = [
  'AI 自動識別麻雀牌面',
  '完全隱藏廣告',
  '每月 200 次識別配額',
];

export function PremiumGate({
  enabled,
  loading = false,
  title = 'AI 拍照功能需要 PRO 會員',
  benefits = DEFAULT_BENEFITS,
  ctaLabel = '升級至 PRO 會員',
  onUpgrade,
  children,
}: PremiumGateProps) {
  if (enabled) return <>{children}</>;

  return (
    <div
      className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-3xl p-6 text-center space-y-4 shadow-sm"
      role="region"
      aria-label="升級解鎖"
    >
      <div className="text-3xl">🔒</div>
      <h3 className="text-lg font-black text-amber-950 tracking-tight">{title}</h3>
      <ul className="space-y-1.5 text-sm text-amber-900/80 max-w-xs mx-auto">
        {benefits.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-amber-500 font-black">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={loading}
        onClick={onUpgrade}
        className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl font-black text-base shadow-lg active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-wait"
      >
        {loading ? '載入中…' : ctaLabel}
      </button>
      <p className="text-[10px] text-amber-900/60">
        付款功能將喺 Phase 3 上線 (Google Play Billing · 信用卡)
      </p>
    </div>
  );
}
