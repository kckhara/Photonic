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
 *
 * "nothing phone" is the phone brand. A search for the lyric word
 * "nothing" also returns that phone described only as a smartphone
 * or an iPhone, so those are skipped too. Other songs can still
 * show a phone.
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
  "nothing phone",
];

// Descriptions of the Nothing Phone that never say the brand name.
const NOTHING_PHONE_WORDS = ["phone", "smartphone", "iphone", "cellphone"];

/**
 * True when this description should be skipped.
 * An empty description is kept — we only skip photos we can tell are a problem.
 * Pass the search words when you have them, so "nothing" can skip phones.
 */
export function altIsBlocked(alt: string, query = ""): boolean {
  const text = alt.toLowerCase();
  // Split on anything that is not a letter or number, so "sign." and
  // "sign," still count as the word "sign".
  const words = wordsIn(text);

  for (const entry of PHOTO_BLOCKLIST) {
    const needle = entry.toLowerCase();

    if (needle.includes(" ")) {
      if (text.includes(needle)) return true;
      continue;
    }

    if (words.includes(needle)) return true;
  }

  if (
    wordsIn(query).includes("nothing") &&
    NOTHING_PHONE_WORDS.some((word) => words.includes(word))
  ) {
    return true;
  }

  return false;
}

/**
 * True when the description actually talks about this picture-word.
 * "sky" matches "sky" and "skies", not "skylight". "harlem" does not
 * match "haarlem". Used so a style word ("light", "texture") can't
 * replace the lyric.
 */
export function altMentionsWord(alt: string, word: string): boolean {
  const needle = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length < 2) return false;

  return wordsIn(alt).some((token) => isSameOrPlural(token, needle));
}

function isSameOrPlural(token: string, word: string): boolean {
  if (token === word || token === `${word}s` || token === `${word}es`) {
    return true;
  }
  // "city" → "cities", "sky" → "skies".
  return word.endsWith("y") && token === `${word.slice(0, -1)}ies`;
}

function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}
