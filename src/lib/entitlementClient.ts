/**
 * entitlementClient — fetch the current user's entitlements.
 *
 * Per spec §6 (GET /api/me/entitlements):
 *   - Returns { isPremium, adsEnabled, canUseAi, remainingAiUses,
 *               resetAt, subscription, fetchedAt }
 *   - 401 AUTH_REQUIRED if user not signed in
 *
 * The hook layer (useEntitlements) is responsible for caching + polling
 * + exposing loading/error state. This module is just the one-call API.
 */

import { request } from './apiClient';
import type { ApiError, Entitlements } from '../types/api';

export async function getEntitlements(): Promise<Entitlements> {
  const r = await request<Entitlements>('/api/me/entitlements', {
    method: 'GET',
    timeoutMs: 10_000, // entitlements should be fast; 10s is generous
  });
  if (r.ok === true) return (r as { ok: true; data: Entitlements }).data;
  const error = (r as { ok: false; error: ApiError }).error;
  throw error;
}
