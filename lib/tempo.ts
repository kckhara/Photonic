/**
 * Tempo cleanup. Deezer's bpm number is sometimes missing or doubled/halved.
 * These rules are from the plan (section 5.4).
 */

const DEFAULT_BPM = 120;

/**
 * Turn a raw Deezer tempo into a usable beats-per-minute number.
 * - missing, 0, or negative → 120
 * - above 170 → cut in half (often stored at double speed)
 * - below 70 → double it (often stored at half speed)
 * Each adjustment happens once, then we round to a whole number.
 */
export function cleanBpm(rawBpm: number | null | undefined): number {
  if (rawBpm == null || !Number.isFinite(rawBpm) || rawBpm <= 0) {
    return DEFAULT_BPM;
  }

  let bpm = rawBpm;

  if (bpm > 170) {
    bpm = bpm / 2;
  }

  if (bpm < 70) {
    bpm = bpm * 2;
  }

  return Math.round(bpm);
}
