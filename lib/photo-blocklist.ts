/**
 * Words and phrases that disqualify a photo from Pexels or Unsplash.
 *
 * If a photo's description contains one of these, we skip it. The goal is
 * to avoid pictures of written words (Scrabble tiles, neon signs, quotes,
 * placards, and a slogan printed on an object)
 * and obvious stock setups (someone smiling at a laptop in an office).
 *
 * Product shots are skipped too. A short lyric word is often part of the
 * object name — "hard" inside "hard drive" — so the photo looks like a
 * match for the line and still gets thrown out.
 *
 * Edit this list freely. You do not need to change any other file.
 * After you save, the next photo lookup uses the new list.
 *
 * Matching rules:
 * - Capital letters do not matter. "Sign" matches "sign".
 * - A single word must be the whole word. "sign" does not match "design".
 *   Plurals are listed on their own. "product" does not match "products".
 * - A phrase must appear as written. "neon sign" matches "a neon sign at
 *   night", but the word "neon" on its own does not. Hyphens and
 *   underscores count as spaces, so "hard drive" matches "hard-drive".
 *
 * A catalog shot of a phone, headphones, or a keyboard is skipped too,
 * in every search. "Nothing" was matching Nothing headphones, and
 * "oblivion" was matching a keycap set, because the lyric word is in
 * the product name. Someone using the object still counts: "hands
 * playing a keyboard", "woman holding a phone". A piano or organ
 * keyboard still counts. A phone booth still counts.
 */

export const PHOTO_BLOCKLIST = [
  "text",
  "word",
  "letters",
  "typography",
  "sign",
  "spell",
  "card",
  "cards",
  "Thank you",
  "Thanks",
  "calligraphy",
  "sketch",
  "sketching",
  // Plurals and other names for the same thing. "sign" does not match "signs".
  "signs",
  "placard",
  "placards",
  "banner",
  "banners",
  "poster",
  "posters",
  "billboard",
  "billboards",
  "slogan",
  "slogans",
  "marquee",
  "marquees",
  "lettering",
  "graffiti",
  "logo",
  "logos",
  "that says",
  "that read",
  "the phrase",
  "quote",
  "written",
  "scrabble",
  "tiles",
  "alphabet",
  "neon sign",
  "smiling",
  // Stock captions talk this way. The picture is an ad, not a scene.
  "promoting",
  "advocating",
  "activewear",
  "body positivity",
  "business",
  "businessman",
  "businesswoman",
  "businessmen",
  "businesswomen",
  "office",
  "coworking",
  "laptop",
  // Unsplash captions name the computer instead of saying "laptop".
  "macbook",
  "macbooks",
  "imac",
  "imacs",
  "posing",
  "nothing phone",
  // Product photography, including objects whose name contains a lyric word.
  "product",
  "products",
  "product photography",
  "product photo",
  "product shot",
  "product image",
  "packshot",
  "packshots",
  "pack shot",
  "merchandise",
  "ecommerce",
  "e commerce",
  "catalog",
  "catalogue",
  "mockup",
  "mockups",
  "gadget",
  "gadgets",
  "knolling",
  "white background",
  "hard drive",
  "hard disk",
  "hard disc",
  "harddrive",
  "harddisk",
  "solid state drive",
  "flash drive",
  "thumb drive",
  "usb drive",
  "pen drive",
  "memory card",
  "graphics card",
  "hdd",
  "ssd",
  "nvme",
  "smartphone",
];

// The object is the whole picture: a product on a stand, not a scene.
const CATALOG_DEVICES = [
  "headphone",
  "headphones",
  "headset",
  "headsets",
  "earphone",
  "earphones",
  "earbud",
  "earbuds",
  "airpod",
  "airpods",
  "smartphone",
  "smartphones",
  "iphone",
  "iphones",
  "cellphone",
  "cellphones",
];

const CATALOG_PHRASES = [
  "computer keyboard",
  "mechanical keyboard",
  "laptop keyboard",
  "gaming keyboard",
  // Captions split these. "earbuds" is already one word above.
  "ear bud",
  "ear buds",
  "air pod",
  "air pods",
  // The product is named "Ear", not "earbuds". "Nothing Ear (1)".
  "nothing ear",
];

// A person in the description means it is a scene, not a product shot.
const SCENE_WORDS = [
  "person",
  "people",
  "man",
  "woman",
  "men",
  "women",
  "boy",
  "girl",
  "child",
  "children",
  "kid",
  "kids",
  "guy",
  "guys",
  "adult",
  "adults",
  "couple",
  "crowd",
  "musician",
  "dj",
  "singer",
  "hand",
  "hands",
  "wearing",
  "worn",
  "holding",
  "held",
  "playing",
  "typing",
  "using",
  "someone",
  "somebody",
];

// "keyboard" alone is a product shot. These are the instrument.
const MUSICAL_KEYBOARDS = [
  "piano",
  "organ",
  "synth",
  "synthesizer",
  "accordion",
  "harpsichord",
];

// "phone" alone is a product shot. These are a place.
const PHONE_PLACES = ["booth", "payphone", "street", "sidewalk"];

/**
 * True when this description should be skipped.
 * An empty description is kept — we only skip photos we can tell are a problem.
 * The search words are accepted so callers can pass them. The catalog
 * check does not need them: a product shot is a product shot in any song.
 */
export function altIsBlocked(alt: string, _query = ""): boolean {
  // Hyphens are spaces, so "hard-drive" is the phrase "hard drive".
  const text = alt.toLowerCase().replace(/[-_]+/g, " ");
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

  if (isCatalogDevice(text, words)) return true;
  if (quotesASlogan(text, words)) return true;

  return false;
}

// Next to a quoted slogan, these mean the words are in the picture.
// "Reading" on its own can be a person with a book, so the quote is required.
const SLOGAN_CUES = [
  "read",
  "reads",
  "reading",
  "says",
  "saying",
  "phrase",
  "printed",
  "labeled",
  "labelled",
  "lettering",
  "slogan",
  "wrapped",
  "inscribed",
  "spelled",
  "spelling",
];

/**
 * True when the caption quotes words that are printed in the picture.
 * "signs that read 'Racism is Not Opinion'". "wrapped with a
 * \"gettin' stronger\" band". A title in a photographer's note, with
 * no cue like "read" or "says", is left alone.
 */
function quotesASlogan(text: string, words: string[]): boolean {
  if (!SLOGAN_CUES.some((word) => words.includes(word))) return false;
  if (/"[^"\n]*\s[^"\n]*"/.test(text)) return true;
  if (/“[^”\n]*\s[^”\n]*”/.test(text)) return true;
  if (/'[^'\n]*\s[^'\n]*'/.test(text)) return true;
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

/**
 * A phone, headphones, or a keyboard photographed as a product.
 * Someone in the description keeps it. So does a piano, or a phone booth.
 */
function isCatalogDevice(text: string, words: string[]): boolean {
  if (SCENE_WORDS.some((word) => words.includes(word))) return false;

  if (CATALOG_DEVICES.some((word) => words.includes(word))) return true;
  if (CATALOG_PHRASES.some((phrase) => text.includes(phrase))) return true;

  const keyboard = words.includes("keyboard") || words.includes("keyboards");
  if (keyboard && !MUSICAL_KEYBOARDS.some((word) => words.includes(word))) {
    return true;
  }

  const phone = words.includes("phone") || words.includes("phones");
  if (phone && !PHONE_PLACES.some((word) => words.includes(word))) return true;

  return false;
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

/**
 * Animated illustrations and cartoon clips. Pexels video search has no
 * description, so this is checked against the page address.
 * "illustration-of-savings" is read as "illustration of savings".
 *
 * Same matching rules as the photo list above. Edit this list freely.
 * The next video lookup uses it. A live clip of a plant called monstera
 * is not on this list.
 *
 * Monstera Production (Pexels user 3372733) uploads this same flat,
 * cartoon illustration style, including clips whose address does not say
 * "animation". Every clip from that account is skipped.
 */
export const VIDEO_BLOCKLIST = [
  "animation",
  "animations",
  "animated",
  "illustration",
  "illustrations",
  "illustrated",
  "illustrator",
  "cartoon",
  "cartoons",
  "anime",
  "motion graphic",
  "motion graphics",
];

export const BLOCKED_VIDEOGRAPHER_IDS = [3372733];

export const BLOCKED_VIDEOGRAPHER_NAMES = ["monstera production"];

/**
 * Accounts whose clips play before everyone else's.
 * Paste a profile address, one per entry. Higher in the list wins.
 * The next video lookup uses the new list. An account is chosen only
 * when their clip is already in the search results for that lyric word.
 * https://www.pexels.com/@arthousestudio/
 */
export const PREFERRED_VIDEOGRAPHERS = [
  "https://www.pexels.com/@arthousestudio/",
  "https://www.pexels.com/@mesut-yalcin-1233429888/",
  "https://www.pexels.com/@koolshooters/",
  "https://www.pexels.com/@cottonbro/",
  "https://www.pexels.com/@kelly/",
];

/** True when this page address is an illustrated or cartoon clip. */
export function videoTextIsBlocked(text: string): boolean {
  return textMatchesList(text, VIDEO_BLOCKLIST);
}

/** True when this Pexels account is blocked from video search. */
export function videographerIsBlocked(
  id: number | undefined,
  name: string,
): boolean {
  if (typeof id === "number" && BLOCKED_VIDEOGRAPHER_IDS.includes(id)) {
    return true;
  }

  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return BLOCKED_VIDEOGRAPHER_NAMES.includes(normalized);
}

/**
 * Where this account sits in PREFERRED_VIDEOGRAPHERS.
 * Accounts that are not on the list share one rank after the last
 * preferred account, so they stay in Pexels' order.
 */
export function preferredVideographerRank(url: string, name: string): number {
  const actual = accountKeys(url, name);

  for (let index = 0; index < PREFERRED_VIDEOGRAPHERS.length; index++) {
    const entry = PREFERRED_VIDEOGRAPHERS[index];
    const handle = handleFrom(entry);
    const keys = handle ? [handle] : accountKeys("", entry);
    if (keys.some((key) => actual.some((candidate) => sameAccount(key, candidate)))) {
      return index;
    }
  }

  return PREFERRED_VIDEOGRAPHERS.length;
}

/** Profile handle, such as "arthousestudio" from a Pexels profile address. */
function handleFrom(value: string): string {
  const match = value.trim().toLowerCase().match(/@([a-z0-9._-]+)/);
  return match?.[1] ?? "";
}

function accountKeys(url: string, name: string): string[] {
  const keys: string[] = [];
  const handle = handleFrom(url);
  if (handle) keys.push(handle);

  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return keys;
  keys.push(normalized.replace(/ /g, ""));
  keys.push(normalized.replace(/ /g, "-"));
  return keys;
}

/**
 * The same account, including when Pexels appends "-12345" to the handle.
 */
function sameAccount(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) && /^-\d+$/.test(longer.slice(shorter.length));
}

function textMatchesList(text: string, entries: readonly string[]): boolean {
  const normalized = text.toLowerCase().replace(/[-_]+/g, " ");
  const words = wordsIn(normalized);

  for (const entry of entries) {
    const needle = entry.toLowerCase();

    if (needle.includes(" ")) {
      if (normalized.includes(needle)) return true;
      continue;
    }

    if (words.includes(needle)) return true;
  }

  return false;
}
