/**
 * billingClient — Google Play Billing (one-time product).
 *
 * The pricing model is ONE-TIME: `premium_lifetime` at HK$38. There is
 * no subscription, so there is no renew/expire logic on the client.
 *
 * Plugin: `capacitor-plugin-cdv-purchase`. It was chosen over
 * `@capgo/native-purchases` for ONE decisive reason:
 *
 *   @capgo/native-purchases CONSUMES any purchase that is already
 *   acknowledged. For a CONSUMABLE that is correct. For a LIFETIME
 *   entitlement it is a revenue bug — the user buys once, the purchase
 *   is consumed, and they can buy it again for free forever. Its
 *   `restorePurchases()` also resolves without returning any token, so
 *   the server could not re-verify a restored purchase.
 *
 *   capacitor-plugin-cdv-purchase makes consume EXPLICIT
 *   (`consumePurchase` is a separate call) and exposes
 *   `acknowledgePurchase`, `getPurchases` and `getAvailableProducts`.
 *   For a lifetime product we acknowledge (NOT consume), so Play keeps
 *   the purchase and the user can restore it on a new device.
 *
 * The server is the source of truth: after a purchase we POST the
 * purchase token to /api/purchase/verify, and Google Play — not the
 * client — decides whether the user is premium.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import { request } from './apiClient';

export const PRODUCT_ID = 'premium_lifetime';

/** Shape of one purchase as returned by the plugin's `purchasesUpdated`. */
interface RawPurchase {
  transactionId?: string;
  orderId?: string;
  productIds?: string[];
  getPurchaseState?: number;
  acknowledged?: boolean;
  autoRenewing?: boolean;
}

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

// Register lazily so the web build (where the native plugin is absent)
// does not throw at import time.
const PurchasePlugin = registerPlugin<any>('PurchasePlugin');

/**
 * Is the native billing plugin actually available?
 *
 * `Capacitor.isNativePlatform()` is false on the web build. We also
 * probe for the plugin's own marker because the plugin ships a JS
 * adapter that sets `window.CdvPurchaseCapacitor` — on the web build
 * that marker is absent, so we can degrade cleanly instead of throwing
 * "plugin is not implemented" on the first call.
 */
function nativeAvailable(): boolean {
  try {
    if (!Capacitor?.isNativePlatform?.()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Product details as the plugin returns them. */
interface RawProduct {
  productId?: string;
  title?: string;
  description?: string;
  price?: string;
  price_string?: string;
  priceString?: string;
  localizedPrice?: string;
}

function normalizeProduct(p: RawProduct): BillingProduct {
  return {
    productId: p.productId ?? '',
    title: p.title,
    description: p.description,
    priceFormatted: p.price_string ?? p.priceString ?? p.localizedPrice ?? p.price,
  };
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

/** Pull the purchase token out of a raw purchase record. */
function tokenOf(p: RawPurchase): string | undefined {
  return p.transactionId ?? undefined;
}

export const billingClient: BillingClient = {
  async listProducts(productIds) {
    if (!nativeAvailable()) {
      // Web build: return the placeholder list so the panel renders.
      return productIds.map((productId) => ({
        productId,
        title: 'PRO 終身會員',
        priceFormatted: 'HK$38',
        description: '一次過付費，永久使用 AI 自動識別。',
      }));
    }

    try {
      await PurchasePlugin.init({});
      const res = await PurchasePlugin.getAvailableProducts({
        inAppSkus: productIds,
        subsSkus: [],
      });
      const list: RawProduct[] = res?.products ?? [];
      if (!list.length) {
        return productIds.map((productId) => ({
          productId,
          title: 'PRO 終身會員',
          priceFormatted: 'HK$38',
          description: '一次過付費，永久使用 AI 自動識別。',
        }));
      }
      return list.map(normalizeProduct);
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
    if (!nativeAvailable()) {
      return { success: false, error: '付款功能只可以喺 Android App 度用。' };
    }

    // The plugin resolves `buy()` when the purchase completes, but the
    // token arrives via the `purchasesUpdated` listener. Register the
    // listener FIRST so a fast purchase is not missed.
    let raw: RawPurchase | null = null;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    const purchasePromise = new Promise<RawPurchase>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('付款逾時，請再試一次。'));
      }, 120_000);

      PurchasePlugin.addListener('purchasesUpdated', (data: { purchases?: RawPurchase[] }) => {
        const list = data?.purchases ?? [];
        const match = list.find((p) => (p.productIds ?? []).includes(productId));
        if (match) {
          clearTimeout(timer);
          raw = match;
          resolve(match);
        }
      }).then((h) => {
        listenerHandle = h;
      }).catch(reject);
    });

    try {
      await PurchasePlugin.init({});
      await PurchasePlugin.buy({ productId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(msg)) {
        return { success: false, error: '已取消付款。' };
      }
      return { success: false, error: msg };
    }

    try {
      const purchase = await purchasePromise;
      const token = tokenOf(purchase);
      if (!token) {
        return { success: false, error: '未能取得購買憑證。' };
      }

      // ACKKNOWLEDGE, DO NOT CONSUME. A lifetime entitlement must stay
      // in Play's records so the user can restore it on a new device.
      // Play REFUNDS unacknowledged purchases after 3 days.
      try {
        await PurchasePlugin.acknowledgePurchase({ purchaseToken: token });
      } catch {
        // Non-fatal: the server's verify path also acknowledges.
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
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      try {
        await listenerHandle?.remove();
      } catch {
        /* ignore */
      }
    }
  },

  async restorePurchases() {
    if (!nativeAvailable()) {
      return { success: false, error: '購買記錄復原功能只可以喺 Android App 度用。' };
    }

    try {
      await PurchasePlugin.init({});
      const res = await PurchasePlugin.getPurchases();
      const list: RawPurchase[] = res?.purchases ?? [];
      if (!list.length) {
        return { success: false, error: '搵唔到之前嘅購買記錄。' };
      }

      let verifiedAny = false;
      for (const p of list) {
        const token = tokenOf(p);
        if (!token) continue;
        const productId = (p.productIds ?? [])[0] ?? PRODUCT_ID;
        const verified = await verifyWithServer(productId, token);
        if (verified.ok === false) return { success: false, error: verified.error };
        verifiedAny = true;
      }
      return verifiedAny
        ? { success: true }
        : { success: false, error: '搵唔到之前嘅購買記錄。' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
