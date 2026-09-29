/**
 * Turns one lyric line into a single picture-word.
 *
 * compromise finds the nouns, adjectives, and verbs. The stop-word list
 * below throws away filler ("the", "yeah", "baby"). Nouns win. If a line
 * has several nouns, we keep the last one — in "a house on fire", that's
 * "fire". If there is no noun, we try an adjective, then a verb.
 * Helper verbs ("can't", "might") are not pictures. A word on the photo
 * blocklist is skipped too, because those photos are thrown away and the
 * scene would fall through to a random picture. A proper name stays whole
 * ("Spanish Harlem", not "Harlem"), so the search isn't a different place.
 *
 * If a junk word shows up on the debug page, add it to STOP_WORDS.
 */

import nlp from "compromise";
import { PHOTO_BLOCKLIST } from "@/lib/photo-blocklist";

// Matching ignores capitals and apostrophes, so "Don't" and "dont" are the same.
const STOP_WORDS = new Set([
  // Words the plan calls out, plus the other little words around them.
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "so",
  "as",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "by",
  "into",
  "over",
  "under",
  "about",
  "up",
  "down",
  "out",
  "off",
  "through",
  "across",
  "around",
  "after",
  "before",
  "between",
  "without",
  "within",
  "along",
  "against",
  "upon",
  "onto",
  "than",
  "like",
  "just",
  "not",
  "no",
  "yes",
  "oh",
  "yeah",
  "yea",
  "yah",
  "ya",
  "nah",
  "baby",
  "babe",

  // Pronouns and contractions ("I'm" becomes "im").
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "me",
  "my",
  "your",
  "our",
  "their",
  "it",
  "its",
  "him",
  "her",
  "them",
  "us",
  "mine",
  "yours",
  "im",
  "ive",
  "id",
  "youre",
  "youve",
  "youd",
  "hes",
  "shes",
  "were",
  "weve",
  "theyre",
  "theyve",
  "dont",
  "doesnt",
  "didnt",
  "cant",
  "wont",
  "aint",
  "isnt",
  "wasnt",
  "werent",
  "arent",
  "thats",
  "whats",
  "theres",
  "heres",
  "lets",

  // Sounds and section labels, not pictures.
  "ooh",
  "oooh",
  "ah",
  "ahh",
  "hey",
  "hi",
  "la",
  "na",
  "da",
  "doo",
  "mm",
  "mmm",
  "hmm",
  "uh",
  "um",
  "whoa",
  "woah",
  "ha",
  "haha",
  "yo",
  "chorus",
  "verse",
  "intro",
  "outro",
  "hook",
  "refrain",
  "instrumental",

  // Words that don't paint a picture.
  "here",
  "there",
  "all",
  "own",
  "long",
  "very",
  "really",
  "too",
  "clearly",
  "actually",
  "finally",
  "simply",
  "totally",
  "exactly",
  "probably",
  "completely",
  "notice",
  "never",
  "always",
  "still",
  "even",
  "only",
  "when",
  "where",
  "what",
  "who",
  "why",
  "how",
  "that",
  "this",
  "these",
  "those",
  "then",
  "now",
  "again",
  "back",
  "away",
  "alone",
  "late",
  "early",
  "soon",
  "place",
  "thing",
  "stuff",
  "way",
  "something",
  "someone",
  "everybody",
  "everyone",
  "anyone",
  "nobody",
  "one",
  // A degree word ("half-erased", "half past"). Searched on its own, stock photos are cut citrus.
  "half",
  "good",
  "bad",
  "big",
  "little",
  "new",
  "more",
  "most",
  "much",
  "many",
  "some",
  "any",
  "other",
  "same",
  "such",
  "real",
  "enough",
  "maybe",
  "hell",
  "fuck",
  "fucking",
  "fuckin",
  "shit",
  "damn",
  "goddamn",

  // Verbs that don't paint a picture. "run" and "dance" are not in this list.
  "be",
  "is",
  "am",
  "are",
  "was",
  "been",
  "being",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "get",
  "got",
  "go",
  "going",
  "gone",
  "come",
  "came",
  "make",
  "made",
  "let",
  "say",
  "said",
  "know",
  "knew",
  "think",
  "thought",
  "feel",
  "felt",
  "want",
  "wanted",
  "need",
  "try",
  "tried",
  "belong",
  "gonna",
  "wanna",
  "gotta",
  "tryna",
  "kinda",
  "show",
  "find",
  "give",
  "take",
  "keep",
  "put",
  "hold",
  "leave",
  "stay",
  "turn",
  "tell",
  "ask",
  "mean",
  "seem",
  "see",
  "look",
  "watch",
]);

// Single words from the photo blocklist. Searching one of these can only
// return photos we then throw away.
const BLOCKED_WORDS = new Set(
  PHOTO_BLOCKLIST.filter((entry) => !entry.includes(" ")).map((entry) =>
    entry.toLowerCase(),
  ),
);

/**
 * The one word we'd search for photos, or null when the line is only filler.
 * A proper name can be two or three words ("new york city").
 */
export function keywordFromLine(line: string): string | null {
  const text = line.trim();
  if (!text) return null;

  const doc = nlp(text);

  // Nouns first. toSingular turns "cities" into "city" so repeats share photos.
  // compromise's types drop nouns() after .not(), so this is cast back.
  const nouns = doc.match("#Noun").not("#Pronoun") as ReturnType<typeof nlp>;
  const noun = pickKeyword(asWordList(nouns.nouns().toSingular().out("array")));
  if (noun) return phraseAround(text, noun);

  const adjective = pickKeyword(asWordList(doc.adjectives().out("array")));
  if (adjective) return adjective;

  // Drop helper verbs ("is", "was", "can't"), then use the dictionary form
  // ("found" → "find") so the stop list can catch the ones that aren't visual.
  const verbPhrases = asWordList(
    doc
      .verbs()
      .not("#Auxiliary")
      .not("#Copula")
      .not("#Modal")
      .out("array"),
  );
  const verbs = verbPhrases.flatMap((phrase) => infinitiveWords(phrase));
  return pickKeyword(verbs);
}

// Walk from the end of the line and keep the first word that is a real picture.
function pickKeyword(words: string[]): string | null {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = cleanWord(words[index]);
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word) || BLOCKED_WORDS.has(word)) continue;
    return word;
  }
  return null;
}

/**
 * "Harlem" inside "Spanish Harlem" should be searched as the whole name.
 * Otherwise Pexels also returns Haarlem in the Netherlands. A place name
 * from compromise wins when it is longer; otherwise a run of capitalized
 * words does ("Mad Hatters"). The first word of a line is capitalized
 * just because it starts the sentence, so it only joins when the next
 * word is capitalized too.
 */
function phraseAround(line: string, noun: string): string {
  const place = placePhrase(line, noun);
  const proper = properPhrase(line, noun);
  const phrases = [noun, place, proper].filter(
    (phrase): phrase is string => Boolean(phrase),
  );
  phrases.sort((a, b) => wordCount(b) - wordCount(a));
  return phrases[0] ?? noun;
}

function placePhrase(line: string, noun: string): string | null {
  const value = nlp(line).places().out("array");
  const places = Array.isArray(value) ? value.map(String) : [];
  let best: string | null = null;

  for (const place of places) {
    const words = place.split(/\s+/);
    if (!words.some((word) => sameWord(word, noun))) continue;
    const normalized = normalizePhrase(place);
    if (!best || wordCount(normalized) > wordCount(best)) best = normalized;
  }

  return best;
}

function properPhrase(line: string, noun: string): string | null {
  const tokens = line.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];
  let index = -1;

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (sameWord(tokens[i], noun)) {
      index = i;
      break;
    }
  }

  if (index < 0 || !isCapital(tokens[index])) return null;

  let start = index;
  while (start > 0 && isCapital(tokens[start - 1])) {
    // The opening word of the line is capitalized either way.
    if (start - 1 === 0 && !isCapital(tokens[start])) break;
    start -= 1;
  }

  if (start === index) return null;
  return normalizePhrase(tokens.slice(start, index + 1).join(" "));
}

function normalizePhrase(phrase: string): string {
  const parts = phrase
    .split(/\s+/)
    .map((word) => cleanWord(word))
    .filter((word) => word.length > 0);

  // "This Broadway" and "The Night" can drop the first word. "New York"
  // must keep "new": it is filler on its own, and part of the name.
  while (
    parts.length > 1 &&
    parts[0] !== "new" &&
    STOP_WORDS.has(parts[0])
  ) {
    parts.shift();
  }
  if (parts.length === 0) return "";

  const last = parts[parts.length - 1];
  parts[parts.length - 1] = singularWord(last);
  return parts.join(" ");
}

function singularWord(word: string): string {
  const value = nlp(word).nouns().toSingular().out("text");
  const singular = typeof value === "string" ? cleanWord(value) : "";
  return singular || word;
}

function sameWord(token: string, noun: string): boolean {
  const cleaned = cleanWord(token);
  return cleaned === noun || singularWord(cleaned) === noun;
}

function isCapital(word: string): boolean {
  return /^[A-Z]/.test(word);
}

function wordCount(phrase: string): number {
  return phrase.split(/\s+/).filter(Boolean).length;
}

function cleanWord(raw: string): string {
  return raw
    .toLowerCase()
    // "city's" should count as "city", not "citys".
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z]/g, "");
}

function asWordList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(/\s+/));
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/\s+/);
  }
  return [];
}

function infinitiveWords(phrase: string): string[] {
  const converted = nlp(phrase).verbs().toInfinitive().out("text");
  const text =
    typeof converted === "string" && converted.trim() ? converted : phrase;
  return text.split(/\s+/);
}
