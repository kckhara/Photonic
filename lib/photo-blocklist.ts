/**
 * Words and phrases that disqualify a Pexels photo.
 *
 * If a photo's description contains one of these, we skip it. The goal is
 * to avoid pictures of written words (Scrabble tiles, neon signs, quotes)
 * and obvious stock setups (someone smiling at a laptop in an office).
 *
 * Edit this list freely. You do not need to change any other file.
 * After you save, the next photo lookup uses the new list.
 *
 * Matching rules:
 * - Capital letters do not matter. "Sign" matches "sign".
 * - A single word must be the whole word. "sign" does not match "design".
 * - A phrase must appear as written. "neon sign" matches "a neon sign at
 *   night", but the word "neon" on its own does not.
 */

export const PHOTO_BLOCKLIST = [
  "text",
  "word",
  "letters",
  "typography",
  "sign",
  "quote",
  "written",
  "scrabble",
  "tiles",
  "alphabet",
  "neon sign",
  "smiling",
  "business",
  "office",
  "laptop",
  "posing",
];

/**
 * True when this description should be skipped.
 * An empty description is kept — we only skip photos we can tell are a problem.
 */
export function altIsBlocked(alt: string): boolean {
  const text = alt.toLowerCase();
  // Split on anything that is not a letter or number, so "sign." and
  // "sign," still count as the word "sign".
  const words = text.split(/[^a-z0-9]+/).filter((word) => word.length > 0);

  for (const entry of PHOTO_BLOCKLIST) {
    const needle = entry.toLowerCase();

    if (needle.includes(" ")) {
      if (text.includes(needle)) return true;
      continue;
    }

    if (words.includes(needle)) return true;
  }

  return false;
}
