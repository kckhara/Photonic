/**
 * Turns lyrics into timed scenes. Photos are added afterwards by pexels.ts.
 *
 * Synced lyrics already have a time on each line, so scenes start there.
 * Plain lyrics have no times, so the words are spread evenly across the song.
 * The same word on neighboring lines becomes one scene (a chorus).
 * At most 20 different words are kept — the ones that show up most often —
 * so we don't ask Pexels for too many photos.
 *
 * If the first lyric starts after 0:00, an opening title card fills that gap.
 * It has no picture-word. The visualizer draws the album cover there.
 * A title or a spoken line stamped at the very start, with a long wait
 * before the singing, is part of that intro — not a picture yet.
 *
 * Each scene remembers how many lyric lines used its word. Mix mode
 * (Phase 9B) plays video only when that count is more than one.
 */

import { keywordFromLine } from "@/lib/keywords";
import type { LyricsType, Photo, Scene } from "@/lib/types";

// One search per word. 20 words stays far under Pexels' 200 requests an hour.
const MAX_UNIQUE_KEYWORDS = 20;

type TimedKeyword = {
  startMs: number;
  keyword: string;
};

type LyricSource = {
  lyricsType: LyricsType;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  durationMs: number;
};

/**
 * Scenes with picture-words and times, but an empty photo list.
 * Returns nothing when the lyrics have no usable words. The song route
 * then asks Pexels for a curated (random) set instead.
 */
export function scenesFromLyrics(source: LyricSource): Scene[] {
  const durationMs = Math.max(0, source.durationMs);

  if (source.lyricsType === "synced" && source.syncedLyrics) {
    const synced = scenesFromTimedLines(
      keywordsFromSyncedLyrics(source.syncedLyrics),
      durationMs,
    );
    if (synced.length > 0) return withTitleCard(synced);
  }

  if (source.plainLyrics && source.lyricsType !== "none") {
    return withTitleCard(scenesFromPlainLyrics(source.plainLyrics, durationMs));
  }

  return [];
}

/**
 * One scene for the whole song, used when there are no lyric words.
 * keyword is empty so the debug page can label these as curated photos.
 */
export function curatedScenes(durationMs: number, photos: Photo[]): Scene[] {
  if (photos.length === 0) return [];

  return [
    {
      startMs: 0,
      endMs: Math.max(0, durationMs),
      keyword: "",
      photos,
    },
  ];
}

/**
 * One scene that walks through every photo on the beat.
 * Used while Spotify is playing a 30-second preview.
 *
 * A preview is often a clip from the middle of the song, but Spotify's
 * clock starts at 0 for that clip. Lyric timestamps would point at the
 * wrong moment, so we ignore them and change photos on the beat instead.
 */
export function beatOnlyScenes(scenes: Scene[], durationMs: number): Scene[] {
  const photos: Photo[] = [];
  const seen = new Set<string>();

  for (const scene of scenes) {
    for (const photo of scene.photos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      photos.push(photo);
    }
  }

  if (photos.length === 0) return [];

  return [
    {
      startMs: 0,
      endMs: Math.max(durationMs, 1),
      keyword: "",
      photos,
    },
  ];
}

function keywordsFromSyncedLyrics(synced: string): TimedKeyword[] {
  const timed: TimedKeyword[] = [];

  for (const line of parseSyncedLyrics(synced)) {
    const keyword = keywordFromLine(line.text);
    if (!keyword) continue;
    timed.push({ startMs: line.startMs, keyword });
  }

  // Do this before the 20-word cap. Dropping later lines would open
  // a fake gap and look like an intro.
  return limitKeywords(dropUnsungOpening(timed));
}

function scenesFromPlainLyrics(plain: string, durationMs: number): Scene[] {
  const keywords: string[] = [];

  for (const raw of plain.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text || isSectionLabel(text)) continue;

    const keyword = keywordFromLine(text);
    if (keyword) keywords.push(keyword);
  }

  // startMs is filled in after the cap, so dropped words don't leave holes.
  const kept = limitKeywords(
    keywords.map((keyword) => ({ startMs: 0, keyword })),
  );
  if (kept.length === 0) return [];

  const spread = kept.map((line, index) => ({
    keyword: line.keyword,
    startMs: Math.round((index * durationMs) / kept.length),
  }));

  return scenesFromTimedLines(spread, durationMs);
}

// [00:12.34] or [00:12:34], possibly several stamps on one line.
const TIMESTAMP = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function parseSyncedLyrics(
  synced: string,
): Array<{ startMs: number; text: string }> {
  const lines: Array<{ startMs: number; text: string }> = [];

  for (const raw of synced.split(/\r?\n/)) {
    const stamps: number[] = [];
    const text = raw
      .replace(TIMESTAMP, (_match, minutes: string, seconds: string, fraction?: string) => {
        stamps.push(timestampToMs(minutes, seconds, fraction));
        return "";
      })
      .trim();

    if (!text || stamps.length === 0 || isSectionLabel(text)) continue;

    // [00:00.00][00:28.00] Same lyric — the first stamp is a placeholder.
    // Word-by-word stamps are only a moment apart, so those all stay.
    for (const startMs of stampsToKeep(stamps)) {
      lines.push({ startMs, text });
    }
  }

  return lines;
}

function timestampToMs(
  minutes: string,
  seconds: string,
  fraction: string | undefined,
): number {
  const wholeSeconds = Number(minutes) * 60 + Number(seconds);
  if (!fraction) return wholeSeconds * 1000;

  // "5" is tenths, "50" is hundredths, "500" is thousandths.
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  return wholeSeconds * 1000 + milliseconds;
}

function isSectionLabel(text: string): boolean {
  return /^[\[(].*[\])]$/.test(text);
}

// A stamp in the first moment of the song. Far enough from a real
// second stamp that it isn't just the next word.
const LEADING_STAMP_MS = 1500;
const LEADING_GAP_MS = 8000;

function stampsToKeep(stamps: number[]): number[] {
  if (stamps.length < 2) return stamps;

  const sorted = [...stamps].sort((a, b) => a - b);
  const earliest = sorted[0];
  const hasMuchLater = sorted.some((stamp) => stamp - earliest >= LEADING_GAP_MS);

  if (earliest <= LEADING_STAMP_MS && hasMuchLater) {
    return sorted.filter((stamp) => stamp > LEADING_STAMP_MS);
  }

  return sorted;
}

/**
 * Some lyric files start with a title ("As It Was - Harry Styles") or a
 * spoken line at 0:00, then a long pause, then the singing. Those early
 * lines are not the first lyric. Drop them so the album cover stays up
 * until the singing starts.
 *
 * A song that really begins with singing is left alone. Once two lines
 * sit a normal distance apart, the vocals have started.
 */
function dropUnsungOpening(lines: TimedKeyword[]): TimedKeyword[] {
  if (lines.length < 2) return lines;

  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push(sorted[index].startMs - sorted[index - 1].startMs);
  }

  const later = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
  const median = later.length > 0 ? later[Math.floor(later.length / 2)] : 4000;

  for (let index = 0; index < gaps.length; index += 1) {
    const gap = gaps[index];

    // A normal pause between two sung lines. The song has started.
    if (gap >= 1000 && gap < LEADING_GAP_MS) return lines;

    if (gap >= LEADING_GAP_MS && gap > median * 2) {
      const lyricStart = sorted[index + 1].startMs;
      return lines.filter((line) => line.startMs >= lyricStart);
    }
  }

  return lines;
}

/**
 * If there are more than 20 different words, keep the ones used most often.
 * A tie keeps the word that showed up earlier in the song.
 */
function limitKeywords(lines: TimedKeyword[]): TimedKeyword[] {
  const counts = new Map<string, number>();
  const firstIndex = new Map<string, number>();

  lines.forEach((line, index) => {
    counts.set(line.keyword, (counts.get(line.keyword) ?? 0) + 1);
    if (!firstIndex.has(line.keyword)) firstIndex.set(line.keyword, index);
  });

  if (counts.size <= MAX_UNIQUE_KEYWORDS) return lines;

  const kept = new Set(
    [...counts.keys()]
      .sort((a, b) => {
        const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
        if (byCount !== 0) return byCount;
        return (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0);
      })
      .slice(0, MAX_UNIQUE_KEYWORDS),
  );

  return lines.filter((line) => kept.has(line.keyword));
}

function scenesFromTimedLines(
  lines: TimedKeyword[],
  durationMs: number,
): Scene[] {
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const scenes: Scene[] = [];
  // How many lines used each word, including lines merged into one scene.
  // A chorus that repeats counts as more than one. Mix mode reads this.
  const mentions = new Map<string, number>();

  for (const line of sorted) {
    if (durationMs > 0 && line.startMs >= durationMs) continue;
    mentions.set(line.keyword, (mentions.get(line.keyword) ?? 0) + 1);

    const startMs = Math.max(0, line.startMs);
    const previous = scenes[scenes.length - 1];

    // Two words stamped at the same moment: keep the later line.
    if (previous && startMs <= previous.startMs) {
      previous.keyword = line.keyword;
      continue;
    }

    // Neighboring lines with the same word are one scene.
    if (previous && previous.keyword === line.keyword) continue;

    scenes.push({
      startMs,
      endMs: durationMs,
      keyword: line.keyword,
      photos: [],
    });
  }

  for (let index = 0; index < scenes.length; index += 1) {
    const next = scenes[index + 1];
    scenes[index].endMs = next
      ? next.startMs
      : Math.max(durationMs, scenes[index].startMs);
  }

  return scenes
    .filter((scene) => scene.endMs > scene.startMs)
    .map((scene) => ({
      ...scene,
      keywordMentions: mentions.get(scene.keyword) ?? 1,
    }));
}

/**
 * When the first lyric is not at the very start, hold a title card
 * from 0:00 until that lyric. Songs that already start at 0 stay as they are.
 */
function withTitleCard(scenes: Scene[]): Scene[] {
  if (scenes.length === 0) return scenes;
  if (scenes[0].titleCard) return scenes;
  if (scenes[0].startMs <= 0) return scenes;

  return [
    {
      startMs: 0,
      endMs: scenes[0].startMs,
      keyword: "",
      photos: [],
      titleCard: true,
    },
    ...scenes,
  ];
}

/** True while the song is still in the opening title card, before the first lyric. */
export function isTitleCardMoment(scenes: Scene[], positionMs: number): boolean {
  const card = scenes.find((scene) => scene.titleCard);
  if (!card) return false;
  return positionMs < card.endMs;
}
