/**
 * Words that make a photo look like stock, and the points those signals add.
 *
 * A match here does not throw the photo out. It raises the score. The
 * lowest scores are the ones that get picked. The hard skip list still
 * lives in lib/photo-blocklist.ts.
 *
 * Edit this file freely. The next lookup uses the new numbers. You do
 * not need to change any other file.
 *
 * Matching rules match the blocklist:
 * - Capital letters do not matter.
 * - A single word must be the whole word. "sign" does not match "design".
 * - A phrase must appear as written. Hyphens in a url count as spaces,
 *   so "copy space" matches a slug like "copy-space".
 */

/** Lightness at or above this (0 to 1) counts as very bright. */
export const BRIGHT_LIGHTNESS = 0.75;
export const BRIGHT_POINTS = 4;

/** Saturation at or above this (0 to 1) counts as very saturated. */
export const SATURATED_LEVEL = 0.6;
export const SATURATED_POINTS = 3;

/** Added once for the description, and again if the url slug has the same word. */
export const STOCK_WORD_POINTS = 2;

/**
 * Added when this photographer is tied for the most photos in cached
 * searches. Small on purpose, so a strong picture can still win.
 */
export const FREQUENT_PHOTOGRAPHER_POINTS = 1;

/** That penalty starts only once a photographer has at least this many cached photos. */
export const FREQUENT_PHOTOGRAPHER_MIN_COUNT = 2;

/** Photos narrower than this are skipped before scoring. */
export const MIN_PHOTO_WIDTH = 1600;

export const STOCK_WORDS = [
  "advertisement",
  "banner",
  "brochure",
  "business",
  "businessman",
  "businesswoman",
  "businessmen",
  "businesswomen",
  "colleagues",
  "commercial",
  "coworking",
  "concept",
  "conference",
  "copy space",
  "corporate",
  "customer",
  "entrepreneur",
  "flat lay",
  "handshake",
  "headset",
  "imac",
  "imacs",
  "isolated",
  "laptop",
  "lifestyle",
  "macbook",
  "macbooks",
  "marketing",
  "meeting",
  "mockup",
  "office",
  "posing",
  "presentation",
  "smiling",
  "startup",
  "stock",
  "studio",
  "success",
  "teamwork",
  "template",
  "white background",
  "workplace",
  "workspace",
];

/**
 * Stock words that appear in this text.
 * Pass a description, or a url slug with the hyphens already turned into spaces.
 */
export function stockWordsIn(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[-_]+/g, " ");
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 0);
  const found: string[] = [];

  for (const entry of STOCK_WORDS) {
    const needle = entry.toLowerCase().trim();
    if (!needle) continue;

    if (needle.includes(" ")) {
      if (normalized.includes(needle)) found.push(entry);
      continue;
    }

    if (words.includes(needle)) found.push(entry);
  }

  return found;
}

/**
 * Brightness and saturation of a hex color, both from 0 to 1.
 * Brightness is HSL lightness: white is 1, black is 0.
 * Saturation is HSL saturation: gray is 0, a pure color is 1.
 * Returns null when the color is not a hex code we can read.
 */
export function colorBrightnessAndSaturation(
  hex: string,
): { brightness: number; saturation: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const red = rgb.red / 255;
  const green = rgb.green / 255;
  const blue = rgb.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const brightness = (max + min) / 2;
  const delta = max - min;

  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * brightness - 1));
  }

  return { brightness, saturation };
}

function parseHex(hex: string): { red: number; green: number; blue: number } | null {
  const value = hex.trim();
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!match) return null;

  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;

  return {
    red: Number.parseInt(full.slice(0, 2), 16),
    green: Number.parseInt(full.slice(2, 4), 16),
    blue: Number.parseInt(full.slice(4, 6), 16),
  };
}
