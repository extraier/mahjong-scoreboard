/**
 * visionProvider.ts — adapter interface for the vision inference layer.
 *
 * Two production implementations:
 *   - providers/minimaxVision.ts  (calls MiniMax /v1/chat/completions)
 *   - providers/stubProvider.ts   (canned response, fallback when key unset)
 *
 * The router (routes/vision.ts) holds a provider reference selected at
 * boot based on config.visionConfigured. There is no runtime swap.
 */

import type { MahjongVisionResult } from '../types.js';

export interface VisionInput {
  /** Raw image bytes — already normalized by imagePipeline (resize, format) */
  imageBytes: Uint8Array;
  /** Original MIME type of the upload */
  imageMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  gameMode: 'HK' | 'TW';
  roundWind: string;
  seatWind: string;
  /** Optional debug hint from frontend ("player already selected W1") */
  tilesAlreadyKnown?: string;
}

export interface VisionProvider {
  /** Stable identifier — recorded in audit log + returned to client in response.provider */
  readonly name: 'minimax' | 'stub' | 'ollama';
  analyze(input: VisionInput): Promise<MahjongVisionResult>;
}
