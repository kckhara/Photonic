/**
 * Turns one lyric line into a single picture-word.
 *
 * compromise finds the nouns, adjectives, and verbs. The stop-word list
 * below throws away filler ("the", "yeah", "baby"). Nouns win. If a line
 * has several nouns, we keep the last one — in "a house on fire", that's
 * "fire". If there is no noun, we try an adjective, then a verb.
 *
 * If a junk word shows up on the debug page, add it to STOP_WORDS.
 */

import nlp from "compromise";

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

/**
 * The one word we'd search for photos, or null when the line is only filler.
 */
export function keywordFromLine(line: string): string | null {
  const text = line.trim();
  if (!text) return null;

  const doc = nlp(text);

  // Nouns first. toSingular turns "cities" into "city" so repeats share photos.
  // compromise's types drop nouns() after .not(), so this is cast back.
  const nouns = doc.match("#Noun").not("#Pronoun") as ReturnType<typeof nlp>;
  const noun = pickKeyword(asWordList(nouns.nouns().toSingular().out("array")));
  if (noun) return noun;

  const adjective = pickKeyword(asWordList(doc.adjectives().out("array")));
  if (adjective) return adjective;

  // Drop helper verbs ("is", "was", "can"), then use the dictionary form
  // ("found" → "find") so the stop list can catch the ones that aren't visual.
  const verbPhrases = asWordList(
    doc.verbs().not("#Auxiliary").not("#Copula").out("array"),
  );
  const verbs = verbPhrases.flatMap((phrase) => infinitiveWords(phrase));
  return pickKeyword(verbs);
}

// Walk from the end of the line and keep the first word that is a real picture.
function pickKeyword(words: string[]): string | null {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = cleanWord(words[index]);
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word)) continue;
    return word;
  }
  return null;
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
