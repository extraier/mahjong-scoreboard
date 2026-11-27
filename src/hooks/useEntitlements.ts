/**
 * useEntitlements — React hook wrapping entitlementClient.
 *
 * Loads entitlements once at mount, optionally re-polls every 60s while
 * the tab is visible (so a purchase in another browser tab surfaces
 * within a minute). Errors are NOT thrown — UI just shows the last
 * successful fetch or a permissive default (free user) when offline.
 *
 * The camera screen reads this cache so a dropped network call does not
 * block manual scoring. Quota is re-fetched when the app is visible again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getEntitlements } from '../lib/entitlementClient';
import type { ApiError, Entitlements } from '../types/api';

const POLL_INTERVAL_MS = 60_000;
const CACHE_KEY = 'mahjong.entitlements.v2';

/**
 * Unknown entitlement. Manual scoring does not read this.
 * adsEnabled is false so we do not offer an ad before a real response.
 * quotaKnown is false so a cached miss is not treated as "zero scans".
 */
const DEFAULT_ENTITLEMENTS: Entitlements = {
  isPremium: false,
  adsEnabled: false,
  canUseAi: false,
  remainingAiUses: 0,
  resetAt: null,
  subscription: null,
  fetchedAt: new Date(0).toISOString(),
  quotaKnown: false,
  adsRemainingToday: null,
};

function readCache(): Entitlements | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entitlements;
    if (typeof parsed?.isPremium !== 'boolean') return null;
    if (typeof parsed.quotaKnown !== 'boolean') return null;
    if (typeof parsed.canUseAi !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entitlements: Entitlements): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entitlements));
  } catch {
    // Private mode / full storage: the in-memory copy still works this session.
  }
}

export interface UseEntitlementsState {
  /** Most recent successful entitlement response, a cache hit, or DEFAULT */
  data: Entitlements;
  /** True on the first fetch when nothing is cached yet */
  loading: boolean;
  /** True once a cache hit or a successful fetch has populated `data` */
  hasSnapshot: boolean;
  /** Most recent error if any (null after a subsequent successful fetch) */
  error: ApiError | null;
  /** Manual refresh — used after a purchase flow completes */
  refresh: () => Promise<void>;
  /**
   * Apply the remaining-scan count from a vision response without waiting
   * for the next poll. Does not unmount an in-progress camera session;
   * the caller decides that.
   */
  applyUsage: (remainingAiUses: number | null) => void;
}

export function useEntitlements(opts: { autoRefresh?: boolean } = {}): UseEntitlementsState {
  const auto = opts.autoRefresh ?? true;
  const [initial] = useState(() => {
    const cached = readCache();
    return { data: cached ?? DEFAULT_ENTITLEMENTS, hasSnapshot: !!cached };
  });
  const [data, setData] = useState<Entitlements>(initial.data);
  const [loading, setLoading] = useState(!initial.hasSnapshot);
  const [hasSnapshot, setHasSnapshot] = useState(initial.hasSnapshot);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await getEntitlements();
      if (!mounted.current) return;
      setData(result);
      setHasSnapshot(true);
      setError(null);
      writeCache(result);
    } catch (e) {
      if (!mounted.current) return;
      // Keep the last snapshot so an offline table is not blocked, and so
      // a known remaining count survives a dropped refresh.
      setError(e as ApiError);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const applyUsage = useCallback((remainingAiUses: number | null) => {
    setData((prev) => {
      const next: Entitlements = {
        ...prev,
        remainingAiUses,
        canUseAi: remainingAiUses === null || remainingAiUses > 0,
        quotaKnown: true,
        fetchedAt: new Date().toISOString(),
      };
      writeCache(next);
      return next;
    });
    setHasSnapshot(true);
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

  return { data, loading, hasSnapshot, error, refresh: load, applyUsage };
}
