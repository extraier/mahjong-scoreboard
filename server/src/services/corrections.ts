/**
 * services/corrections.ts — store user-reported tile corrections.
 *
 * When the AI predicts tiles incorrectly, the player hits the "report wrong"
 * button on the result review screen and (optionally) edits the tile chips.
 * Each correction write creates a row in `vision_corrections` linking:
 *
 *   - the original AI prediction (image_hash, predicted_tiles, confidences)
 *   - the corrected tiles (ground truth) the player typed in
 *   - the request_id tying it back to vision_calls.log
 *
 * Downstream: when we collect >= 500 corrections for a given tile type,
 * a weekly cron can rebuild the training set with the corrections weighted
 * higher than the synthetic data, then trigger a model retrain.
 */
import { getFirebase } from '../firebase.js';

const CORRECTIONS_COLLECTION = 'vision_corrections';

export interface CorrectionRecord {
  uid: string;
  request_id: string;
  image_hash: string;
  /** What the AI predicted. */
  predicted_tiles: string[];
  /** What the user corrected to (ground truth). */
  corrected_tiles: string[];
  /** Tile types in the prediction that were wrong. */
  wrong_tiles: string[];
  /** Free-text note from user (optional). */
  note?: string;
  /** Whether the user opted in to sharing the raw photo for training. */
  photo_consent: boolean;
  /** Storage path if photo_consent && photo uploaded. */
  photo_path?: string;
  /** Created at ISO + Firestore ts. */
  created_at: string;
  created_at_ts: import('firebase-admin/firestore').Timestamp;
}

/**
 * Write a correction. Fire-and-forget; never throws to the caller.
 * Returns a promise that resolves when the write completes (or fails).
 */
export function recordCorrection(args: Omit<CorrectionRecord, 'created_at' | 'created_at_ts'>): Promise<void> {
  return (async () => {
    try {
      const { firestore } = getFirebase();
      const now = new Date();
      await firestore.collection(CORRECTIONS_COLLECTION).add({
        ...args,
        created_at: now.toISOString(),
        created_at_ts: now,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[corrections] recordCorrection failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  })();
}

/**
 * Compute which tiles were wrong on either side.
 *
 * Returns a deduped list of tiles that appear in one side but not the other
 * (after balancing counts). For example:
 *
 *   predicted [W1, W2, W3]   corrected [W1, W2, W4]
 *     W3 was wrongly predicted (extra in predicted, missing in corrected)
 *     W4 was wrongly missed (extra in corrected, missing in predicted)
 *   → wrong_tiles: [W3, W4]
 *
 * The function does NOT distinguish "extra predicted" from "missing from
 * prediction" — both are weighted equally for retraining purposes. If we
 * later need direction info, we can split this into two arrays.
 */
export function diffTiles(predicted: string[], corrected: string[]): string[] {
  const pCounts = new Map<string, number>();
  for (const t of predicted) pCounts.set(t, (pCounts.get(t) ?? 0) + 1);
  const cCounts = new Map<string, number>();
  for (const t of corrected) cCounts.set(t, (cCounts.get(t) ?? 0) + 1);

  const allTiles = new Set([...pCounts.keys(), ...cCounts.keys()]);
  const wrong: string[] = [];
  for (const tile of allTiles) {
    const pCount = pCounts.get(tile) ?? 0;
    const cCount = cCounts.get(tile) ?? 0;
    if (pCount !== cCount) {
      // Tile is present in unequal counts on the two sides → wrong.
      wrong.push(tile);
    }
  }
  return wrong;
}
