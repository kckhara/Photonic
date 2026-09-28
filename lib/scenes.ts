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

function keywordsFromSyncedLyrics(synced: string): TimedKeyword[] {
  const timed: TimedKeyword[] = [];

  for (const line of parseSyncedLyrics(synced)) {
    const keyword = keywordFromLine(line.text);
    if (!keyword) continue;
    timed.push({ startMs: line.startMs, keyword });
  }

  return limitKeywords(timed);
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

    for (const startMs of stamps) {
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

  for (const line of sorted) {
    if (durationMs > 0 && line.startMs >= durationMs) continue;

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

  return scenes.filter((scene) => scene.endMs > scene.startMs);
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
