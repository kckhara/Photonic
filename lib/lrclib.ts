/**
 * LRCLIB helpers. These run on the server only.
 *
 * LRCLIB is free and does not need an API key. It does require a User-Agent
 * header that names this app (LRCLIB_USER_AGENT in .env.local).
 */

import type { LyricsType } from "@/lib/types";

// Remember a lyrics answer for a day. Lyrics for a published song rarely change.
const ONE_DAY_SECONDS = 86400;

type LrcRecord = {
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export type LyricsLookup = {
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
};

export type Lyrics = {
  lyricsType: LyricsType;
  // Null when that version wasn't included, or the track is instrumental.
  syncedLyrics: string | null;
  plainLyrics: string | null;
};

/**
 * Fetch lyrics and say whether they are synced, plain, or missing.
 * Tries an exact LRCLIB match first. If that misses, searches and
 * keeps the result whose length is closest to the Deezer duration.
 */
export async function getLyrics(song: LyricsLookup): Promise<Lyrics> {
  const exact = await fetchExact(song);
  const record = exact ?? (await fetchClosest(song));
  const lyricsType = classify(record);

  // Instrumentals and misses shouldn't leak leftover text into keywords.
  if (lyricsType === "none") {
    return { lyricsType, syncedLyrics: null, plainLyrics: null };
  }

  return {
    lyricsType,
    syncedLyrics: record?.syncedLyrics?.trim() || null,
    plainLyrics: record?.plainLyrics?.trim() || null,
  };
}

function classify(record: LrcRecord | null): LyricsType {
  if (!record || record.instrumental) return "none";

  // Synced lines have timestamps, so they win over a plain block of text.
  if (record.syncedLyrics?.trim()) return "synced";
  if (record.plainLyrics?.trim()) return "plain";
  return "none";
}

async function fetchExact(song: LyricsLookup): Promise<LrcRecord | null> {
  const url = lrclibUrl("get", {
    track_name: song.title,
    artist_name: song.artist,
    album_name: song.album,
    duration: String(Math.round(song.durationSeconds)),
  });

  const response = await lrclibFetch(url);

  // 404 means "no exact match" — the caller tries search next.
  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`LRCLIB lookup failed (${response.status}).`);
  }

  return (await response.json()) as LrcRecord;
}

async function fetchClosest(song: LyricsLookup): Promise<LrcRecord | null> {
  const url = lrclibUrl("search", {
    track_name: song.title,
    artist_name: song.artist,
  });

  const response = await lrclibFetch(url);

  if (!response.ok) {
    throw new Error(`LRCLIB search failed (${response.status}).`);
  }

  const results = (await response.json()) as LrcRecord[];
  return pickClosestDuration(results, song.durationSeconds);
}

/**
 * Keep the search hit whose duration is nearest the real song length.
 * If two are equally close, the earlier one (LRCLIB's own ranking) wins.
 */
function pickClosestDuration(
  results: LrcRecord[],
  durationSeconds: number,
): LrcRecord | null {
  let closest: LrcRecord | null = null;
  let closestGap = Infinity;

  for (const result of results) {
    if (typeof result.duration !== "number") continue;

    const gap = Math.abs(result.duration - durationSeconds);
    if (gap < closestGap) {
      closest = result;
      closestGap = gap;
    }
  }

  return closest;
}

function lrclibUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`https://lrclib.net/api/${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function lrclibFetch(url: string): Promise<Response> {
  const userAgent = process.env.LRCLIB_USER_AGENT;

  if (!userAgent) {
    throw new Error(
      "Missing LRCLIB_USER_AGENT. Add it to .env.local and restart npm run dev.",
    );
  }

  return fetch(url, {
    headers: {
      // LRCLIB asks every app to identify itself. The value stays on the server.
      "User-Agent": userAgent,
    },
    next: { revalidate: ONE_DAY_SECONDS },
  });
}
