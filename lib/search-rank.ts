/**
 * How well a song title and artist match what was typed.
 *
 * Used to merge Deezer's results with songs Deezer's search misses.
 * "jesus christ brand new" should prefer Jesus Christ by Brand New over a
 * different song that merely contains those words in a long title.
 */

// Words that sit between a title and an artist, not part of either name.
const FILLER = new Set([
  "a",
  "an",
  "the",
  "by",
  "feat",
  "ft",
  "featuring",
]);

/**
 * Higher means a closer match. 0 means none of the typed words appear.
 * An exact title match beats a longer title that only contains the words.
 * When the typed words name both the title and the artist, that beats either alone.
 * One wrong letter still counts ("felings" matches "feelings"), so a typo
 * does not hide the song.
 */
export function songMatchScore(
  query: string,
  title: string,
  artistName: string,
): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;

  const titleTokens = tokens(title);
  const artistTokens = tokens(artistName);

  const covered = queryTokens.filter(
    (token) =>
      titleTokens.some((titleToken) => sameToken(token, titleToken)) ||
      artistTokens.some((artistToken) => sameToken(token, artistToken)),
  ).length;
  const titleFull =
    titleTokens.length > 0 &&
    titleTokens.every((token) =>
      queryTokens.some((queryToken) => sameToken(token, queryToken)),
    );
  const artistFull =
    artistTokens.length > 0 &&
    artistTokens.every((token) =>
      queryTokens.some((queryToken) => sameToken(token, queryToken)),
    );

  let score = covered * 10;
  if (covered === queryTokens.length) score += 25;
  if (titleFull) score += 20;
  if (artistFull) score += 20;
  if (titleFull && artistFull) score += 40;
  return score;
}

/**
 * Where each recording sits in the two search lists.
 * A missing index means that list did not return the song.
 */
export type SongPlacement = {
  score: number;
  deezerIndex: number | null;
  spotifyIndex: number | null;
};

/**
 * Best matches first. A recording Deezer's search skipped stays ahead of
 * an equally close Deezer hit, because that skip is the bug we are fixing.
 * Deezer's own order is kept when the scores are equal and both songs
 * came from Deezer.
 */
export function comparePlacements(a: SongPlacement, b: SongPlacement): number {
  if (b.score !== a.score) return b.score - a.score;

  const aSpot = placement(a);
  const bSpot = placement(b);
  if (aSpot !== bSpot) return aSpot - bSpot;

  const aMissing = a.deezerIndex === null;
  const bMissing = b.deezerIndex === null;
  if (aMissing !== bMissing) return aMissing ? -1 : 1;

  return (a.deezerIndex ?? a.spotifyIndex ?? 0) - (b.deezerIndex ?? b.spotifyIndex ?? 0);
}

function placement(song: SongPlacement): number {
  if (song.deezerIndex === null) return song.spotifyIndex ?? 0;
  if (song.spotifyIndex === null) return song.deezerIndex;
  return Math.min(song.deezerIndex, song.spotifyIndex);
}

/** Same title and artist, ignoring capitals, accents, and filler words. */
export function songIdentity(title: string, artistName: string): string {
  return `${tokens(title).join(" ")}|${tokens(artistName).join(" ")}`;
}

// "felings" and "feelings" are the same word. "hard" and "hand" are not:
// a one-letter slip only counts once the word is long enough to be obvious.
function sameToken(a: string, b: string): boolean {
  if (a === b) return true;

  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length < 5 || longer.length - shorter.length > 1) return false;

  if (a.length === b.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    const [first, second] = mismatches;
    return (
      second === first + 1 && a[first] === b[second] && a[second] === b[first]
    );
  }

  let longIndex = 0;
  let shortIndex = 0;
  let skipped = false;
  while (longIndex < longer.length && shortIndex < shorter.length) {
    if (longer[longIndex] === shorter[shortIndex]) {
      longIndex += 1;
      shortIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function tokens(value: string): string[] {
  const folded = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const all = folded.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  const meaningful = all.filter((token) => !FILLER.has(token));
  return meaningful.length > 0 ? meaningful : all;
}
