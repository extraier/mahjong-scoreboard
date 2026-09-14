/**
 * SubscriptionPanel — manages subscription state visible to the user.
 *
 * Phase 1: read-only. Lists current entitlement state and the available
 * product (which is a stub in Phase 1 — billingClient returns "Phase 3
 * pending" errors).
 *
 * Phase 3 wires:
 *   - launchPurchaseFlow → calls native Billing flow → backend verifies
 *     purchase token → Entitlement.refresh() picks up new state
 *   - restorePurchases → re-sync on fresh install
 *
 * Spec ref: §7, §9
 */

import { useEffect, useState } from 'react';
import { billingClient, type BillingProduct } from '../lib/billingClient';
import type { Entitlements } from '../types/api';

const PRODUCT_IDS = ['premium_monthly'];

export interface SubscriptionPanelProps {
  entitlements: Entitlements;
  onRefresh: () => Promise<void>;
}

export function SubscriptionPanel({ entitlements, onRefresh }: SubscriptionPanelProps) {
  const [products, setProducts] = useState<BillingProduct[]>([]);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    billingClient.listProducts(PRODUCT_IDS).then((p) => {
      if (!cancelled) setProducts(p);
    });
    return () => { cancelled = true; };
  }, []);

  const handlePurchase = async (productId: string) => {
    setBusy(productId);
    setError(null);
    const res = await billingClient.launchPurchaseFlow(productId);
    setBusy(null);
    if (!res.success) {
      setError(res.error || '付款流程未能啟動。');
      return;
    }
    // Phase 3: backend verifies purchase token → entitlement updates
    await onRefresh();
  };

  const handleRestore = async () => {
    setBusy('__restore__');
    setError(null);
    const res = await billingClient.restorePurchases();
    setBusy(null);
    if (!res.success) {
      setError(res.error || '復原購買記錄失敗。');
      return;
    }
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
        <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest mb-2">
          目前會員狀態
        </p>
        <div className="flex items-center justify-between">
          <span className="text-lg font-black text-emerald-950">
            {entitlements.isPremium ? '✨ PRO 會員' : '免費會員'}
          </span>
          {entitlements.subscription && (
            <span className="text-xs text-emerald-700">
              到期 {new Date(entitlements.subscription.expiresAt).toLocaleDateString('zh-HK')}
            </span>
          )}
        </div>
      </div>

      {!entitlements.isPremium && (
        <div className="bg-white border-2 border-emerald-300 rounded-2xl p-4 space-y-3">
          <h4 className="font-black text-emerald-950 text-base">升級至 PRO</h4>
          <ul className="text-sm text-emerald-900 space-y-1 list-disc pl-4">
            <li>AI 自動識別麻雀牌面（每月 ~200 次）</li>
            <li>完全隱藏廣告</li>
            <li>優先支援新功能</li>
          </ul>
          {products.map((p) => (
            <button
              key={p.productId}
              type="button"
              onClick={() => handlePurchase(p.productId)}
              disabled={busy !== null}
              className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-black text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60"
            >
              {busy === p.productId ? '開啟付款流程…' : `訂閱 ${p.title}`}
            </button>
          ))}
          {error && <p className="text-xs text-red-700 bg-red-50 p-2 rounded">{error}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={handleRestore}
        disabled={busy !== null}
        className="w-full text-xs text-emerald-700 underline disabled:opacity-60"
      >
        {busy === '__restore__' ? '復原中…' : '復原之前嘅購買記錄'}
      </button>
    </div>
  );
}
