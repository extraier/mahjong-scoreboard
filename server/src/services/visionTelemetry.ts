/**
 * services/visionTelemetry.ts — fire-and-forget AI usage telemetry.
 *
 * Goal: build a dataset for the next model retrain. We log every successful
 * AI vision call (with image hash + predicted tiles + user identity) to a
 * Firestore collection `vision_calls`. When the player manually corrects the
 * AI's predicted tiles via the in-app "report wrong" button, we write a
 * separate `vision_corrections` collection linking the call → ground truth.
 *
 * Privacy:
 * - We store image_hash (SHA-256 of bytes), NOT the raw image. Storage
 *   path is only written when the player explicitly opts in to sharing
 *   the photo for model improvement.
 * - Per-user docs are partitioned by uid so a user can request deletion.
 *
 * Performance:
 * - All writes are fire-and-forget. We don't await them in the response
 *   path so a slow Firestore write doesn't slow the player's UI.
 *
 * Failure mode:
 * - Firestore writes that fail are silently dropped (logged at debug level
 *   only). A missed telemetry write is a training-data loss, not a user
 *   failure.
 */
import { createHash } from 'node:crypto';
import { getFirebase } from '../firebase.js';
import type { MahjongVisionResult } from '../types.js';

const TELEMETRY_COLLECTION = 'vision_calls';

export interface VisionCallRecord {
  uid: string;
  /** SHA-256 of the image bytes. Stable per photo, dedupes duplicates. */
  image_hash: string;
  /** Predicted tile classes. */
  predicted_tiles: string[];
  /** Overall confidence (0-1). */
  confidence: number;
  /** Provider that produced these predictions. */
  provider: string;
  /** Request ID returned to the client (correlates with logs). */
  request_id: string;
  /** Wall-clock ISO timestamp of the analyze call. */
  created_at: string;
}

/**
 * Hash image bytes for dedup + privacy. SHA-256 is fast enough; collision
 * probability is negligible at the scale of one user's photos.
 *
 * Accepts either Buffer or Uint8Array (the image pipeline normalizes to
 * Uint8Array but other call sites may pass Buffer directly).
 */
export function hashImage(bytes: Buffer | Uint8Array): string {
  // Node's crypto accepts Uint8Array in modern versions; cast for type compat.
  return createHash('sha256').update(bytes as Buffer).digest('hex');
}

/**
 * Log a successful AI vision call. Fire-and-forget: never throws.
 * Returns a promise that resolves when the write completes (or fails).
 */
export function logVisionCall(record: VisionCallRecord): Promise<void> {
  // Wrap in async IIFE so the caller doesn't have to await; we swallow
  // errors silently because missed telemetry isn't a user-facing bug.
  return (async () => {
    try {
      const { firestore } = getFirebase();
      await firestore.collection(TELEMETRY_COLLECTION).add({
        ...record,
        // created_at as Firestore Timestamp for query/sort
        created_at_ts: new Date(record.created_at),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[visionTelemetry] logVisionCall failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  })();
}

/**
 * Convenience: build a VisionCallRecord from raw inputs. Used by the
 * vision route handler to keep the route logic tidy.
 */
export function buildVisionCallRecord(args: {
  uid: string;
  imageBytes: Buffer | Uint8Array;
  result: MahjongVisionResult;
  provider: string;
  requestId: string;
}): VisionCallRecord {
  return {
    uid: args.uid,
    image_hash: hashImage(args.imageBytes),
    predicted_tiles: args.result.tiles,
    confidence: args.result.confidence,
    provider: args.provider,
    request_id: args.requestId,
    created_at: new Date().toISOString(),
  };
}
