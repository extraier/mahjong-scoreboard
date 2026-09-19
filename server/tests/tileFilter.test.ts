/**
 * tileFilter.test.ts — unit tests for HK / TW tile validation + adaptive conf.
 */
import { describe, it, expect } from 'vitest';
import {
  adaptiveMinConfidence,
  filterByConfidence,
  filterInvalidTiles,
  isValidTile,
  MAX_COPIES_PER_TILE,
} from '../src/services/tileFilter.js';

describe('isValidTile', () => {
  it('accepts all W/T/S numbers', () => {
    for (const suit of ['W', 'T', 'S']) {
      for (let n = 1; n <= 9; n++) {
        expect(isValidTile(`${suit}${n}`)).toBe(true);
      }
    }
  });

  it('accepts F1-F7 in HK mode (東南西北 中 發 白)', () => {
    for (let n = 1; n <= 7; n++) {
      expect(isValidTile(`F${n}`, 'HK')).toBe(true);
    }
  });

  it('rejects F8 and F9 (do not exist in HK)', () => {
    expect(isValidTile('F8', 'HK')).toBe(false);
    expect(isValidTile('F9', 'HK')).toBe(false);
  });

  it('accepts H1-H8 in HK mode (flowers)', () => {
    for (let n = 1; n <= 8; n++) {
      expect(isValidTile(`H${n}`, 'HK')).toBe(true);
    }
  });

  it('rejects H1-H8 in TW mode (no flowers)', () => {
    for (let n = 1; n <= 8; n++) {
      expect(isValidTile(`H${n}`, 'TW')).toBe(false);
    }
  });

  it('rejects non-string and malformed', () => {
    expect(isValidTile(undefined)).toBe(false);
    expect(isValidTile(null)).toBe(false);
    expect(isValidTile(123)).toBe(false);
    expect(isValidTile('W0')).toBe(false);
    expect(isValidTile('W10')).toBe(false);
    expect(isValidTile('XX')).toBe(false);
    expect(isValidTile('XX', 'HK')).toBe(false);
    expect(isValidTile('F0', 'HK')).toBe(false);
  });
});

describe('filterInvalidTiles', () => {
  it('removes non-existent tiles (F8, F9) in HK mode', () => {
    const result = filterInvalidTiles(['W1', 'F8', 'F9', 'T5', 'S3'], 'HK');
    expect(result).toEqual(['W1', 'T5', 'S3']);
  });

  it('keeps H1-H8 in HK mode', () => {
    const result = filterInvalidTiles(['W1', 'H1', 'H2', 'H8'], 'HK');
    expect(result).toEqual(['W1', 'H1', 'H2', 'H8']);
  });

  it('removes flowers in TW mode', () => {
    const result = filterInvalidTiles(['W1', 'H1', 'H8'], 'TW');
    expect(result).toEqual(['W1']);
  });

  it('caps at MAX_COPIES_PER_TILE=4 (drops 5th copy and beyond)', () => {
    const result = filterInvalidTiles(
      ['W1', 'W1', 'W1', 'W1', 'W1', 'W1', 'T2'],
      'HK',
    );
    expect(result).toEqual(['W1', 'W1', 'W1', 'W1', 'T2']);
  });

  it('preserves tile order', () => {
    const result = filterInvalidTiles(['T3', 'W1', 'F6', 'T3', 'F8'], 'HK');
    expect(result).toEqual(['T3', 'W1', 'F6', 'T3']);
  });

  it('handles empty input', () => {
    expect(filterInvalidTiles([], 'HK')).toEqual([]);
    expect(filterInvalidTiles([], 'TW')).toEqual([]);
  });

  it('MAX_COPIES_PER_TILE exported and equals 4', () => {
    expect(MAX_COPIES_PER_TILE).toBe(4);
  });
});

describe('adaptiveMinConfidence', () => {
  it('returns 0.2 for tiny images (height < 100 or width < 600)', () => {
    expect(adaptiveMinConfidence(320, 35)).toBe(0.2);
    expect(adaptiveMinConfidence(500, 200)).toBe(0.2);
    expect(adaptiveMinConfidence(1199, 99)).toBe(0.2);
  });

  it('returns 0.3 for mid-resolution (height 100-200 or width 600-1000)', () => {
    expect(adaptiveMinConfidence(800, 150)).toBe(0.3);
    expect(adaptiveMinConfidence(900, 180)).toBe(0.3);
  });

  it('returns 0.4 for high-resolution (height >= 200 AND width >= 1000)', () => {
    expect(adaptiveMinConfidence(1200, 200)).toBe(0.4);
    expect(adaptiveMinConfidence(1920, 1080)).toBe(0.4);
    expect(adaptiveMinConfidence(1500, 250)).toBe(0.4);
  });
});

describe('filterByConfidence', () => {
  it('keeps tiles at or above the threshold', () => {
    const confs = [0.5, 0.3, 0.45, 0.1, 0.7];
    // Default threshold 0.4 for high-res 1200x200
    const accepted = filterByConfidence(confs, 1200, 200);
    expect(accepted).toEqual([0, 2, 4]);
  });

  it('relaxes threshold for low-res images', () => {
    const confs = [0.5, 0.3, 0.45, 0.1, 0.7];
    // Low-res: threshold 0.2 — keeps 0.3+0.1+0.7 etc above
    const accepted = filterByConfidence(confs, 320, 35);
    expect(accepted).toEqual([0, 1, 2, 4]);
  });

  it('returns empty array for empty input', () => {
    expect(filterByConfidence([], 1200, 200)).toEqual([]);
  });

  it('returns empty array when all confidences below threshold', () => {
    expect(filterByConfidence([0.1, 0.2, 0.3], 1200, 200)).toEqual([]);
    // but at low-res threshold 0.2, 0.2 and 0.3 pass (>= threshold)
    expect(filterByConfidence([0.1, 0.2, 0.3], 320, 35)).toEqual([1, 2]);
  });
});
