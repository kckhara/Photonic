/**
 * LRCLIB helpers. These run on the server only.
 *
 * LRCLIB is free and does not need an API key. It does require a User-Agent
 * header that names this app (LRCLIB_USER_AGENT in .env.local).
 */

import { unstable_cache } from "next/cache";
import type { LyricsType } from "@/lib/types";

// Remember a parsed lyrics answer for a day. Lyrics for a published song
// rarely change. A failed request is thrown, so it is not saved.
const ONE_DAY_SECONDS = 86400;

// The first try after the site has been idle often hits a dead connection.
// LRCLIB also asks us to wait out a short 503 or 429.
const ATTEMPTS = 3;

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

// Another release can share the title and still sing the lines at
// different times. Only borrow its timestamps when the length is this close.
const SYNCED_DURATION_WINDOW_SECONDS = 8;

/**
 * Fetch lyrics and say whether they are synced, plain, or missing.
 * Tries an exact LRCLIB match first. If that record has no timestamps,
 * searches for another release of the same song whose length is close
 * and whose lyrics are synced. Otherwise keeps the plain text, or the
 * closest search hit when the exact lookup missed.
 *
 * The parsed answer is what gets cached. An exact miss is a 404, so that
 * call runs on every visit. If it fails, the search result is still used.
 */
export async function getLyrics(song: LyricsLookup): Promise<Lyrics> {
  return cachedLyrics(
    song.title,
    song.artist,
    song.album,
    normalizeDuration(song.durationSeconds),
  );
}

const cachedLyrics = unstable_cache(fetchLyrics, ["lrclib-lyrics"], {
  revalidate: ONE_DAY_SECONDS,
});

async function fetchLyrics(
  title: string,
  artist: string,
  album: string,
  durationSeconds: number,
): Promise<Lyrics> {
  const song: LyricsLookup = { title, artist, album, durationSeconds };

  // The exact record often has no timestamps, and a search is then
  // required. Start that search now so the two waits overlap. If the
  // exact record is already synced, the search result is unused.
  const searchPromise = searchLyrics(song).then(
    (results) => results,
    (error: unknown) => {
      console.error("LRCLIB search failed", error);
      return null;
    },
  );

  let exact: LrcRecord | null = null;
  try {
    exact = await fetchExact(song);
  } catch (error) {
    // Keep going. The search was started already and may have the lyrics.
    console.error("LRCLIB exact lookup failed", error);
  }

  if (exact?.instrumental) {
    return { lyricsType: "none", syncedLyrics: null, plainLyrics: null };
  }

  if (hasSyncedLyrics(exact)) return asLyrics(exact);

  const results = await searchPromise;
  // Both calls failed. Throw so this is not saved as "no lyrics".
  if (results === null && !exact) throw new Error("LRCLIB lookup failed.");

  const synced = results
    ? pickClosestSynced(results, song.durationSeconds)
    : null;
  const record =
    synced ??
    exact ??
    (results ? pickClosestDuration(results, song.durationSeconds) : null);
  return asLyrics(record);
}

function classify(record: LrcRecord | null): LyricsType {
  if (!record || record.instrumental) return "none";

  // Synced lines have timestamps, so they win over a plain block of text.
  if (record.syncedLyrics?.trim()) return "synced";
  if (record.plainLyrics?.trim()) return "plain";
  return "none";
}

async function fetchExact(song: LyricsLookup): Promise<LrcRecord | null> {
  const params: Record<string, string> = {
    track_name: song.title,
    artist_name: song.artist,
    album_name: song.album,
  };
  // Duration must be 1–3600 or LRCLIB answers 400 and the search never runs.
  if (song.durationSeconds >= 1) {
    params.duration = String(song.durationSeconds);
  }

  const result = await lrclibJson<LrcRecord>(lrclibUrl("get", params));
  // 404 means "no exact match" — the caller tries search next.
  if (result.notFound) return null;
  return result.body;
}

async function searchLyrics(song: LyricsLookup): Promise<LrcRecord[]> {
  const result = await lrclibJson<LrcRecord[]>(
    lrclibUrl("search", {
      track_name: song.title,
      artist_name: song.artist,
    }),
  );

  // Search returns an empty list when nothing matches. A 404 here is not that.
  if (result.notFound) throw new Error("LRCLIB search failed (404).");
  return Array.isArray(result.body) ? result.body : [];
}

function hasSyncedLyrics(record: LrcRecord | null): boolean {
  return Boolean(record && !record.instrumental && record.syncedLyrics?.trim());
}

function asLyrics(record: LrcRecord | null): Lyrics {
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

/**
 * The synced hit whose length is nearest the real song, as long as it
 * is close enough to share the same timing. Earlier search hits win a tie.
 */
function pickClosestSynced(
  results: LrcRecord[],
  durationSeconds: number,
): LrcRecord | null {
  let closest: LrcRecord | null = null;
  let closestGap = Infinity;

  for (const result of results) {
    if (!hasSyncedLyrics(result) || typeof result.duration !== "number") continue;

    const gap = Math.abs(result.duration - durationSeconds);
    if (gap > SYNCED_DURATION_WINDOW_SECONDS || gap >= closestGap) continue;

    closest = result;
    closestGap = gap;
  }

  return closest;
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

function normalizeDuration(seconds: number): number {
  const rounded = Math.round(seconds);
  if (!Number.isFinite(rounded) || rounded < 1 || rounded > 3600) return 0;
  return rounded;
}

function lrclibUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`https://lrclib.net/api/${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

type LrcJson<T> = { notFound: true } | { notFound: false; body: T };

/**
 * One LRCLIB call, with a short retry when the connection or the server
 * fails. The raw response is not cached. Callers cache the lyrics they parsed.
 */
async function lrclibJson<T>(url: string): Promise<LrcJson<T>> {
  const userAgent = process.env.LRCLIB_USER_AGENT;

  if (!userAgent) {
    throw new Error(
      "Missing LRCLIB_USER_AGENT. Add it to .env.local and restart npm run dev.",
    );
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          // LRCLIB asks every app to identify itself. The value stays on the server.
          "User-Agent": userAgent,
        },
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
      if (attempt === ATTEMPTS) throw error;
      console.error("LRCLIB request failed, retrying", error);
      await wait(250 * attempt);
      continue;
    }

    if (response.status === 404) {
      await drain(response);
      return { notFound: true };
    }

    if (!response.ok) {
      const delay = retryDelayMs(response, attempt);
      await drain(response);
      if (delay === null || attempt === ATTEMPTS) {
        throw new Error(`LRCLIB request failed (${response.status}).`);
      }
      console.error(`LRCLIB answered ${response.status}, retrying`);
      await wait(delay);
      continue;
    }

    try {
      return { notFound: false, body: JSON.parse(await response.text()) as T };
    } catch (error) {
      lastError = error;
      if (attempt === ATTEMPTS) {
        throw new Error("LRCLIB returned a response that was not JSON.");
      }
      console.error("LRCLIB returned unreadable JSON, retrying", error);
      await wait(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LRCLIB request failed.");
}

// 429 with a long Retry-After is a real limit. Hammering it can get the app banned.
function retryDelayMs(response: Response, attempt: number): number | null {
  if (!isTransientStatus(response.status)) return null;

  const hinted = Number(response.headers.get("retry-after"));
  const hintedMs = Number.isFinite(hinted) && hinted >= 0 ? hinted * 1000 : null;
  if (response.status === 429 && hintedMs !== null && hintedMs > 2000) return null;

  return Math.min(2000, Math.max(200, hintedMs ?? 250 * attempt));
}

function isTransientStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

// An unread body holds the connection. The next lyrics call then fails on it.
async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // The status is what we needed. A bad body should not hide that.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
