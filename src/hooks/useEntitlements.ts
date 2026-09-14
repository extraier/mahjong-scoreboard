/**
 * useEntitlements — React hook wrapping entitlementClient.
 *
 * Loads entitlements once at mount, optionally re-polls every 60s while
 * the tab is visible (so a purchase in another browser tab surfaces
 * within a minute). Errors are NOT thrown — UI just shows the last
 * successful fetch or a permissive default (free user) when offline.
 *
 * Spec §9: PremiumGate must react to entitlement changes without a
 * full reload. A simple useState + useEffect cache is enough for Phase 1.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getEntitlements } from '../lib/entitlementClient';
import type { ApiError, Entitlements } from '../types/api';

const POLL_INTERVAL_MS = 60_000;

/**
 * Permissive default when we have no data (offline / loading / error).
 * Shows ads + blocks AI — same as the explicit "free user" response.
 * This is the spec's "loading state should not flash ads" goal — we
 * treat unknown as free-by-default which keeps the UI honest.
 */
const DEFAULT_ENTITLEMENTS: Entitlements = {
  isPremium: false,
  adsEnabled: true,
  canUseAi: false,
  remainingAiUses: 0,
  resetAt: null,
  subscription: null,
  fetchedAt: new Date(0).toISOString(),
};

export interface UseEntitlementsState {
  /** Most recent successful entitlement response, or DEFAULT if none yet */
  data: Entitlements;
  /** True on the first fetch; false after first response (success OR error) */
  loading: boolean;
  /** Most recent error if any (null after a subsequent successful fetch) */
  error: ApiError | null;
  /** Manual refresh — used after a purchase flow completes */
  refresh: () => Promise<void>;
}

export function useEntitlements(opts: { autoRefresh?: boolean } = {}): UseEntitlementsState {
  const auto = opts.autoRefresh ?? true;
  const [data, setData] = useState<Entitlements>(DEFAULT_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await getEntitlements();
      if (!mounted.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e as ApiError);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    if (!auto) return;
    const id = setInterval(load, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auto, load]);

  return { data, loading, error, refresh: load };
}
