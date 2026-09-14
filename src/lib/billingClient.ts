/**
 * billingClient — Phase 3 stub.
 *
 * Phase 1 ONLY verifies the wiring. The actual Google Play Billing
 * library integration (Capacitor 6 + Billing Library 8+) lands in
 * Phase 3 alongside RTDN + purchase-token verification.
 *
 * For now, the server-side entitlement is the source of truth, so the
 * UI just calls `refreshEntitlements()` from useEntitlements to pick up
 * a new purchase state.
 */

export interface BillingProduct {
  productId: string;
  /** Localized title / price / description from the store */
  title?: string;
  priceFormatted?: string;
}

export interface BillingClient {
  /** Discover subscription products from the store (Google Play / App Store) */
  listProducts(productIds: string[]): Promise<BillingProduct[]>;
  /** Launch the native purchase flow and return a platform-issued token
   *  that the backend will verify (server is source of truth, never
   *  trust the client). */
  launchPurchaseFlow(productId: string): Promise<{
    success: boolean;
    purchaseToken?: string;
    /** The backend could not verify the token in time, user-facing
     *  error message; UI should show this verbatim */
    error?: string;
  }>;
  /** Re-sync currently owned subscriptions (e.g. after restoring purchase
   *  on a fresh install). The backend will re-verify and update the
   *  subscription row. */
  restorePurchases(): Promise<{ success: boolean; error?: string }>;
}

/**
 * Phase 1 stub implementation. All calls resolve to a Phase-3-pending
 * error so the UI is forced to clearly tell users the feature is
 * shipping soon.
 *
 * This will be replaced in Phase 3 with the real Google Play Billing
 * bridge inside `capacitor.config.ts`'s Plugins section.
 */
export const billingClient: BillingClient = {
  async listProducts(productIds) {
    // Return a fake product list so the SubscriptionPanel can render
    // without crashing in Phase 1.
    return productIds.map(productId => ({
      productId,
      title: `${productId} (即將推出)`,
      priceFormatted: '—',
    }));
  },

  async launchPurchaseFlow(productId) {
    return {
      success: false,
      error: '付款功能在 Phase 1 階段尚未啟用。請留待 Phase 3 上線。',
    };
  },

  async restorePurchases() {
    return {
      success: false,
      error: '購買記錄復原功能在 Phase 1 階段尚未啟用。',
    };
  },
};
