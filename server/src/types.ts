/**
 * types.ts — backend-side mirror of frontend's src/types/api.ts. Kept as a
 * separate module so the server never depends on Vite/React. Shape is
 * identical; if you change one, change both.
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'AI_PREMIUM_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'IMAGE_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'IMAGE_UNCLEAR'   // 422 — quality validation rejected the photo (blurry / too small / dark / bright). Frontend should show retry_hint.
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL'
  | 'UPSTREAM';

export interface Entitlements {
  isPremium: boolean;
  adsEnabled: boolean;
  canUseAi: boolean;
  remainingAiUses: number;
  resetAt: string | null;
  subscription: Subscription | null;
  fetchedAt: string;
}

export interface Subscription {
  platform: 'google_play';
  productId: string;
  expiresAt: string;
  autoRenewing: boolean;
  purchaseToken: string;
}

export interface MahjongVisionResult {
  tiles: string[];
  flowers: string[];
  uncertainTiles: Array<{ index: number; reason: string }>;
  confidence: number;
  notes: string[];
}

export interface VisionAnalyzeRequest {
  gameMode: 'HK' | 'TW';
  roundWind: string;
  seatWind: string;
}

export interface VisionAnalyzeResponse {
  requestId: string;
  provider: 'minimax' | 'stub' | 'ollama' | 'local';
  result: MahjongVisionResult;
  usage: { remainingAiUses: number };
}

export interface ApiErrorResponse {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
