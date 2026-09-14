/**
 * UpgradeModal — Phase 1 stub upgrade dialog.
 *
 * Triggered by:
 *   - <PremiumGate onUpgrade=...> when free user taps an AI affordance
 *   - <SubscriptionPanel onUpgrade=...> from settings tab
 *
 * Phase 1 confirm action: tells the mock-server to flip to premium and
 * refreshes entitlements so the rest of the app reacts. Phase 3 replaces
 * this with a real launchPurchaseFlow(BillingClient.launchPurchaseFlow)
 * and shows a server-verified success state.
 */

interface UpgradeModalProps {
  onClose: () => void;
  onConfirm: () => void;
}

export function UpgradeModal({ onClose, onConfirm }: UpgradeModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 p-6 text-white">
          <p className="text-[10px] font-black tracking-widest uppercase opacity-80">
            麻雀神器
          </p>
          <h2 id="upgrade-modal-title" className="text-2xl font-black mt-1">
            升級至 PRO ✨
          </h2>
          <p className="text-sm opacity-90 mt-2 leading-relaxed">
            解鎖全部 AI 自動識別功能，並完全隱藏廣告。支援隨時取消。
          </p>
        </div>

        <div className="p-6 space-y-3">
          <ul className="text-sm text-slate-700 space-y-2">
            <li className="flex gap-2">
              <span className="text-emerald-600 font-black">✓</span>
              AI 自動識別麻雀牌面（每月約 200 次）
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-600 font-black">✓</span>
              完全隱藏廣告
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-600 font-black">✓</span>
              優先試用新功能
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-600 font-black">✓</span>
              隨時喺 Google Play 取消訂閱
            </li>
          </ul>

          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
            <span className="text-2xl font-black text-emerald-900">HK$38</span>
            <span className="text-sm text-emerald-700 ml-1">/ 月</span>
            <p className="text-[10px] text-emerald-600 mt-1">
              試用 7 日後先收費 · 隨時取消
            </p>
          </div>

          <button
            type="button"
            onClick={onConfirm}
            className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-black shadow-md active:scale-95 transition-transform"
          >
            立即升級
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-slate-500 font-bold"
          >
            之後先算
          </button>
        </div>
      </div>
    </div>
  );
}
