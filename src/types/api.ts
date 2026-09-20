/**
 * Shared API types for the frontend service layer.
 *
 * These mirror the backend OpenAPI contract (Phase 2 of the spec). Any
 * change here should be reflected in `server/src/openapi.yaml` and the
 * backend route handlers. Do not put UI-only state in this file — keep
 * it strictly aligned with the server response shapes.
 *
 * Spec ref: mahjong-scoreboard-hermes-implementation-spec.md §6
 */

// ============================================================================
// Error envelope
// ============================================================================

/**
 * Backend error codes per spec §6 error table. The HTTP status alone is
 * not enough — the frontend must dispatch UX on the code, because the
 * same 4xx can map to different user actions (upgrade CTA vs. retry).
 */
export type ApiErrorCode =
  | 'AUTH_REQUIRED'           // 401 — surface login
  | 'AI_PREMIUM_REQUIRED'     // 403 — surface upgrade modal
  | 'IMAGE_TOO_LARGE'         // 413 — ask for smaller image
  | 'UNSUPPORTED_IMAGE'       // 415 — ask for JPEG/PNG/WebP
  | 'IMAGE_UNCLEAR'           // 422 — show retake tip
  | 'AI_QUOTA_EXCEEDED'       // 429 — show reset time
  | 'VISION_PROVIDER_ERROR'   // 502 — generic retry, no provider detail
  | 'NETWORK'                 // fetch failed, timeout, CORS
  | 'INTERNAL'                // 5xx other than 502
  ;

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Optional per-code extra context (e.g. quota resetAt for 429) */
  meta?: Record<string, unknown>;
  /** HTTP status if any */
  status?: number;
}

// ============================================================================
// Entitlement (GET /api/me/entitlements)
// ============================================================================

export interface SubscriptionInfo {
  platform: 'google_play' | 'stripe' | 'apple_iap';
  productId: string;
  expiresAt: string;       // ISO 8601
  autoRenewing: boolean;
}

export interface Entitlements {
  isPremium: boolean;
  adsEnabled: boolean;
  canUseAi: boolean;
  /** null if no quota system (e.g. premium without monthly cap) */
  remainingAiUses: number | null;
  resetAt: string | null;  // ISO 8601
  subscription: SubscriptionInfo | null;
  /** When the entitlement data was fetched; useful for cache busting */
  fetchedAt: string;
}

// ============================================================================
// Vision (POST /api/vision/analyze)
// ============================================================================

export interface UncertainTile {
  /** 0-indexed position in the tiles array */
  index: number;
  /** Human-readable reason, e.g. "upper-right corner is occluded" */
  reason: string;
  /** Optional model-confidence for this specific tile */
  confidence?: number;
}

export type GameMode = 'HK' | 'TW';
export type SeatWind = '東' | '南' | '西' | '北';
export type RoundWind = '東' | '南' | '西' | '北';

export interface MahjongVisionResult {
  /** Recognized tile IDs, e.g. ["W1", "T5", "J1"] */
  tiles: string[];
  /** Flower tiles separately because they don't count for scoring */
  flowers: string[];
  uncertainTiles: UncertainTile[];
  /** 0..1 overall confidence */
  confidence: number;
  /** Free-form model notes for the user to review */
  notes: string[];
}

export interface VisionAnalyzeResponse {
  requestId: string;
  provider: 'minimax' | 'gemini' | 'disabled';
  result: MahjongVisionResult;
  /** Quota state after this request (server-side) */
  usage: {
    remainingAiUses: number | null;
  };
}

/**
 * Request body for POST /api/vision/correct — the player submits the
 * ground-truth tile list for a previous AI prediction. Used to collect
 * training data for the next model retrain.
 */
export interface VisionCorrectRequest {
  /** requestId returned by /api/vision/analyze. */
  request_id: string;
  /** Ground-truth tiles (what the player says they actually had). */
  corrected_tiles: string[];
  /** Optional free-text note (e.g. "left tile was partially occluded"). */
  note?: string;
  /** Whether the user consents to using the original photo for retraining. */
  photo_consent: boolean;
}

export interface VisionCorrectResponse {
  request_id: string;
  diff_count: number;
  message: string;
}

// ============================================================================
// Request payload for vision (used by visionClient)
// ============================================================================

export interface VisionAnalyzeRequest {
  image: File | Blob;
  gameMode: GameMode;
  roundWind: RoundWind;
  seatWind: SeatWind;
}
