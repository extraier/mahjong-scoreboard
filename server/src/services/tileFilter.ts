/**
 * tileFilter.ts — HK mahjong rule validation + post-filter pipeline.
 *
 * Why: ViT classifier occasionally outputs labels that don't exist in HK rules
 * (e.g. F8, F9) or low-confidence tiles. We post-filter at the provider
 * boundary so the rest of the system only sees valid tiles.
 *
 * HK tile set:
 *   W1-W9  (萬 man)
 *   T1-T9  (筒 pin)
 *   S1-S9  (索 sou)
 *   F1-F7  (東南西北 中 發 白 — honor tiles)
 *   H1-H8  (花 flowers, HK mode only)
 *
 * TW mode (Taiwan / 16-tile) drops flowers (H1-H8) and uses F1-F7 same as HK.
 *
 * This is rule-based, not learned — so deterministic and easy to test.
 */

export type GameMode = 'HK' | 'TW';

/** All valid tile labels in HK rules. */
const HK_VALID_TILES = new Set<string>([
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
]);

/** Valid tile labels for TW (Taiwan) rules. Drops flowers (H1-H8). */
const TW_VALID_TILES = new Set<string>([
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
]);

/**
 * Returns true if the tile label is a valid HK / TW tile code.
 * Useful for tests and for filtering unrecognised labels upstream.
 */
export function isValidTile(tile: unknown, mode: GameMode = 'HK'): tile is string {
  if (typeof tile !== 'string') return false;
  if (mode === 'TW') return TW_VALID_TILES.has(tile);
  return HK_VALID_TILES.has(tile);
}

/**
 * Tile multiset for a complete HK hand has max 4 of any single tile.
 * (Mahjong uses 4 copies of each tile.) Tiles exceeding count 4 are
 * physical impossibilities — typically a ViT hallucination that hit the
 * same class repeatedly for confused crops.
 */
export const MAX_COPIES_PER_TILE = 4;

/**
 * Filter a tile multiset against HK / TW rules.
 *
 * Drops:
 *   - tiles not in the valid set for the given mode
 *   - tiles exceeding max copies (4) — keeps the first 4 occurrences
 *
 * Returns a new array; does not mutate input. Order preserved.
 *
 * @param tiles   raw labels from a vision provider
 * @param mode    HK or TW rule set
 * @returns       filtered tiles
 */
export function filterInvalidTiles(tiles: readonly string[], mode: GameMode = 'HK'): string[] {
  const seen: Record<string, number> = {};
  const out: string[] = [];
  for (const t of tiles) {
    if (!isValidTile(t, mode)) continue;
    seen[t] = (seen[t] ?? 0) + 1;
    if (seen[t] > MAX_COPIES_PER_TILE) continue;
    out.push(t);
  }
  return out;
}

/**
 * Determine the minimum-confidence threshold to accept a tile based on
 * image dimensions. Low-resolution images yield lower confidences from
 * the classifier, so we relax the threshold for them.
 *
 * Empirically (2026-09-19):
 *   - 600x200+ photos: conf 0.4+ is reliable → threshold 0.4
 *   - < 80px tall: classifier tops out at ~0.23 conf (e.g. 320x35) → 0.2
 *   - < 200px tall but ≥ 80px: keep 0.4 (don't accept noise like T9)
 *
 * @param width   image width in pixels
 * @param height  image height in pixels
 * @returns       minimum confidence to accept a tile (0..1)
 */
export function adaptiveMinConfidence(width: number, height: number): number {
  // Only relax threshold for very-tiny images. Mid-res still uses 0.4
  // because the classifier is reliable enough on real photos.
  if (height < 80 || width < 400) return 0.2;
  return 0.4;
}

/**
 * Filter rejected (low-confidence) tiles by image-aware threshold.
 *
 * If `confidences[i] < adaptiveMinConfidence(width, height)`, that tile is
 * rejected and should NOT appear in the final tiles array.
 *
 * Returns indices of accepted tiles.
 */
export function filterByConfidence(
  confidences: readonly number[],
  width: number,
  height: number,
): number[] {
  const threshold = adaptiveMinConfidence(width, height);
  const accepted: number[] = [];
  for (let i = 0; i < confidences.length; i++) {
    if (confidences[i] >= threshold) accepted.push(i);
  }
  return accepted;
}
