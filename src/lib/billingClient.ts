/**
 * billingClient — Google Play Billing (one-time product).
 *
 * The pricing model is ONE-TIME: `premium_lifetime` at HK$38. There is
 * no subscription, so there is no renew/expire logic on the client.
 *
 * IMPORTANT — this is the CAPACITOR NATIVE path. It uses the
 * `@capgo/native-purchases` plugin, which talks to the Play Billing
 * Library inside the WebView. It is NOT available on the web build, so
 * every function degrades to a clear error there.
 *
 * The server is the source of truth: after a successful purchase we
 * POST the purchase token to /api/purchase/verify, and Play — not the
 * client — decides whether the user is premium.
 */

import { request } from './apiClient';

export const PRODUCT_ID = 'premium_lifetime';

export interface BillingProduct {
  productId: string;
  /** Localized title / price / description from the store */
  title?: string;
  priceFormatted?: string;
  description?: string;
}

export interface BillingClient {
  /** Discover products from the store (Google Play / App Store) */
  listProducts(productIds: string[]): Promise<BillingProduct[]>;
  /** Launch the native purchase flow and return a platform-issued token
   *  that the backend will verify (server is source of truth, never
   *  trust the client). */
  launchPurchaseFlow(productId: string): Promise<{
    success: boolean;
    purchaseToken?: string;
    productId?: string;
    /** The backend could not verify the token in time, user-facing
     *  error message; UI should show this verbatim */
    error?: string;
  }>;
  /** Re-sync currently owned purchases (e.g. after restoring a purchase
   *  on a fresh install). The backend re-verifies and updates the
   *  entitlement. */
  restorePurchases(): Promise<{ success: boolean; error?: string }>;
}

/**
 * Is the native billing plugin actually available?
 *
 * `Capacitor.isNativePlatform()` is false on the web build, and the
 * plugin is also absent on the web build's bundle. We probe the plugin
 * registry rather than assuming, because a missing plugin throws
 * "plugin is not implemented" only when you CALL it.
 */
function nativePlugin(): any | null {
  try {
    // Imported lazily and statically so Vite does not try to resolve the
    // plugin on the web build where it is not installed.
    const cap = (globalThis as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    const plugins = (cap as any).Plugins;
    return plugins?.NativePurchases ?? plugins?.nativePurchases ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the server to verify a purchase token. The server calls the Play
 * Developer API and grants the entitlement.
 */
async function verifyWithServer(
  productId: string,
  purchaseToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await request<{ ok: boolean }>('/api/purchase/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, purchaseToken }),
    timeoutMs: 30_000,
  });
  if (r.ok === false) {
    return { ok: false, error: r.error?.message ?? '付費驗證失敗。' };
  }
  return { ok: true };
}

export const billingClient: BillingClient = {
  async listProducts(productIds) {
    const plugin = nativePlugin();
    if (!plugin) {
      // Web build: return the placeholder list so the panel renders.
      return productIds.map((productId) => ({
        productId,
        title: 'PRO 終身會員',
        priceFormatted: 'HK$38',
        description: '一次過付費，永久使用 AI 自動識別。',
      }));
    }

    try {
      const entries = await plugin.getProducts({ ids: productIds });
      const list = Array.isArray(entries) ? entries : entries?.products ?? [];
      return list.map((p: any) => ({
        productId: p.id ?? p.productId,
        title: p.title,
        priceFormatted: p.price,
        description: p.description,
      }));
    } catch (e) {
      return productIds.map((productId) => ({
        productId,
        title: 'PRO 終身會員',
        priceFormatted: 'HK$38',
        description: e instanceof Error ? e.message : undefined,
      }));
    }
  },

  async launchPurchaseFlow(productId) {
    const plugin = nativePlugin();
    if (!plugin) {
      return {
        success: false,
        error: '付款功能只可以喺 Android App 度用。',
      };
    }

    try {
      const purchase = await plugin.purchaseProduct({ productId });
      const token = purchase?.purchaseToken ?? purchase?.token;
      if (!token) {
        return { success: false, error: '未能取得購買憑證。' };
      }

      // The server is the authority. If verification fails, do NOT claim
      // success — the user has paid but we could not confirm it, so say
      // so honestly and let them restore.
      const verified = await verifyWithServer(productId, token);
      if (verified.ok === false) {
        return { success: false, error: verified.error };
      }
      return { success: true, purchaseToken: token, productId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Play returns "User cancelled" when the user backs out — that is
      // not an error worth shouting about.
      if (/cancel/i.test(msg)) {
        return { success: false, error: '已取消付款。' };
      }
      return { success: false, error: msg };
    }
  },

  async restorePurchases() {
    const plugin = nativePlugin();
    if (!plugin) {
      return { success: false, error: '購買記錄復原功能只可以喺 Android App 度用。' };
    }

    try {
      const purchases = await plugin.getPurchases();
      const list = Array.isArray(purchases) ? purchases : purchases?.purchases ?? [];
      if (!list.length) {
        return { success: false, error: '搵唔到之前嘅購買記錄。' };
      }
      for (const p of list) {
        const token = p?.purchaseToken ?? p?.token;
        if (!token) continue;
        const verified = await verifyWithServer(p.productId ?? PRODUCT_ID, token);
        if (verified.ok === false) return { success: false, error: verified.error };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
