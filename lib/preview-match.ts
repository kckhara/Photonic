/**
 * Find where a 30-second preview sits in the song by comparing what is
 * sung in the clip with the timed lyrics.
 *
 * The transcript gives each word a time inside the clip. Each lyric line
 * has a time in the song. When a line shows up in the transcript, the
 * difference between those two times is a guess at where the clip starts.
 * Several lines agreeing on the same guess is the answer. One line on its
 * own could be a chorus that repeats, so it needs to be a long, clean match.
 */

export type TranscriptWord = { word: string; startMs: number };
export type LyricLine = { startMs: number; text: string };

// How far apart two guesses can be and still count as the same answer.
// Lyric stamps and the transcript are each off by a fraction of a second.
const AGREE_MS = 1_500;
// A line has to be mostly there. Singing is hard to transcribe.
const MIN_LINE_SCORE = 0.6;
// Lines this short ("oh yeah") are too common to place the clip.
const MIN_LINE_WORDS = 3;
// One matched line alone has to be at least this many words, almost exact.
const SOLO_LINE_WORDS = 5;
const SOLO_LINE_SCORE = 0.85;

type Guess = { offsetMs: number; weight: number; line: number };

/**
 * Milliseconds into the song where the clip starts, or null when the
 * transcript doesn't line up with the lyrics well enough to trust.
 */
export function matchPreviewStart(
  words: TranscriptWord[],
  lines: LyricLine[],
  songDurationMs: number,
): number | null {
  const sung = words
    .map((item) => ({ token: normalizeWord(item.word), startMs: item.startMs }))
    .filter((item) => item.token.length > 0);
  if (sung.length < MIN_LINE_WORDS) return null;

  const guesses: Guess[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = tokenize(line.text);
    if (tokens.length < MIN_LINE_WORDS) return;

    for (let i = 0; i < sung.length; i += 1) {
      if (!sameWord(sung[i].token, tokens[0]) && !sameWord(sung[i].token, tokens[1] ?? "")) {
        continue;
      }
      const window = sung.slice(i, i + tokens.length + 2).map((item) => item.token);
      const score = commonWords(tokens, window) / tokens.length;
      if (score < MIN_LINE_SCORE) continue;

      // If the transcript dropped the first word, the line still started
      // a moment earlier than this word.
      const offsetMs = line.startMs - sung[i].startMs;
      if (offsetMs < -AGREE_MS) continue;
      if (songDurationMs > 0 && offsetMs > songDurationMs) continue;

      guesses.push({ offsetMs, weight: score * tokens.length, line: lineIndex });
    }
  });

  if (guesses.length === 0) return null;
  guesses.sort((a, b) => a.offsetMs - b.offsetMs);

  let best: Guess[] = [];
  let bestWeight = 0;
  for (let start = 0; start < guesses.length; start += 1) {
    const group: Guess[] = [];
    for (let end = start; end < guesses.length; end += 1) {
      if (guesses[end].offsetMs - guesses[start].offsetMs > AGREE_MS) break;
      group.push(guesses[end]);
    }
    const weight = groupWeight(group);
    if (weight > bestWeight) {
      best = group;
      bestWeight = weight;
    }
  }

  const distinctLines = new Set(best.map((guess) => guess.line)).size;
  const strongest = Math.max(...best.map((guess) => guess.weight));
  const solo =
    strongest >= SOLO_LINE_WORDS * SOLO_LINE_SCORE &&
    best.some(
      (guess) =>
        guess.weight === strongest &&
        guess.weight / tokenize(lines[guess.line].text).length >= SOLO_LINE_SCORE,
    );
  if (distinctLines < 2 && !solo) return null;

  return Math.max(0, Math.round(weightedMedian(best)));
}

/** Count each line once, at its best match, so a repeat can't outvote. */
function groupWeight(group: Guess[]): number {
  const byLine = new Map<number, number>();
  for (const guess of group) {
    byLine.set(guess.line, Math.max(byLine.get(guess.line) ?? 0, guess.weight));
  }
  let total = 0;
  for (const weight of byLine.values()) total += weight;
  return total;
}

function weightedMedian(group: Guess[]): number {
  const sorted = [...group].sort((a, b) => a.offsetMs - b.offsetMs);
  const half = sorted.reduce((sum, guess) => sum + guess.weight, 0) / 2;
  let running = 0;
  for (const guess of sorted) {
    running += guess.weight;
    if (running >= half) return guess.offsetMs;
  }
  return sorted[sorted.length - 1].offsetMs;
}

/** Longest run of shared words, in order, allowing words in between. */
function commonWords(line: string[], window: string[]): number {
  const rows = line.length + 1;
  const cols = window.length + 1;
  const table: number[] = new Array(rows * cols).fill(0);
  for (let r = 1; r < rows; r += 1) {
    for (let c = 1; c < cols; c += 1) {
      table[r * cols + c] = sameWord(line[r - 1], window[c - 1])
        ? table[(r - 1) * cols + (c - 1)] + 1
        : Math.max(table[(r - 1) * cols + c], table[r * cols + (c - 1)]);
    }
  }
  return table[rows * cols - 1];
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((token) => token.length > 0);
}

/** Lowercase letters only. "Smokin'" and "smoking" become the same word. */
export function normalizeWord(word: string): string {
  const plain = word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (plain.length > 4 && plain.endsWith("in")) return `${plain}g`;
  return plain;
}

function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return withinOneEdit(a, b);
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
