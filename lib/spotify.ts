import { unstable_cache } from "next/cache";

/**
 * Spotify helpers that run on the server only.
 *
 * This file talks to Spotify using our app's ID and secret (from .env.local).
 * The secret never goes to the browser.
 */

// Remember an ISRC → Spotify id match for a day. The match itself doesn't change hourly.
const ONE_DAY_SECONDS = 86400;

// Keep the last token in memory so we don't ask Spotify for a new one on every request.
// Tokens last about 1 hour.
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

/**
 * Get an "app-only" Spotify access token (client credentials).
 * This is not a user's login — it only lets us search for tracks.
 */
export async function getSpotifyAppToken(): Promise<string> {
  const now = Date.now();

  // Reuse a token if it still has at least 60 seconds left.
  if (cachedToken && now < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Spotify keys. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local (and restart npm run dev).",
    );
  }

  // Spotify expects: Basic + base64(clientId:clientSecret)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(
      `Spotify token request failed (${response.status}). Check that your Client ID and Secret are correct.`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

/**
 * Look up a Spotify track ID using an ISRC (the universal song ID from Deezer).
 * Returns null if Spotify has no matching track.
 * Throws if Spotify's search is down, so a hiccup is not saved as "no match".
 *
 * The request itself includes a short-lived token, so we remember the
 * resulting track id for 24 hours instead of caching that request.
 */
export const findSpotifyTrackIdByIsrc = unstable_cache(
  lookupSpotifyTrackId,
  ["spotify-track-by-isrc"],
  { revalidate: ONE_DAY_SECONDS },
);

// Spotify's search often answers 502 even for songs that are in the catalog.
// A few tries usually gets a real answer. A thrown error is not cached.
const SEARCH_ATTEMPTS = 4;

async function lookupSpotifyTrackId(isrc: string): Promise<string | null> {
  const token = await getSpotifyAppToken();
  let lastStatus = 0;

  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    if (attempt > 1) await wait(250 * (attempt - 1));

    const result = await requestSpotifyTrackId(token, isrc);
    if (result.status === "found") return result.id;
    if (result.status === "missing") return null;
    lastStatus = result.status;
  }

  throw new Error(`Spotify search failed (${lastStatus}).`);
}

type SearchResult =
  | { status: "found"; id: string }
  | { status: "missing" }
  | { status: number };

async function requestSpotifyTrackId(
  token: string,
  isrc: string,
): Promise<SearchResult> {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", `isrc:${isrc}`);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    // Don't save this call under the current token. The wrapper above
    // saves the track id on its own.
    cache: "no-store",
  });

  // 500–504 are Spotify's gateway failing, not "this song doesn't exist".
  if (response.status >= 500 && response.status <= 504) {
    return { status: response.status };
  }

  if (!response.ok) {
    throw new Error(`Spotify search failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    tracks?: { items?: { id: string }[] };
  };

  const id = data.tracks?.items?.[0]?.id;
  if (!id) return { status: "missing" };
  return { status: "found", id };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type SpotifyTrackHit = {
  title: string;
  artistName: string;
  isrc: string;
};

// Same window as Deezer search. A repeated query should not ask Spotify again.
const SEARCH_CACHE_SECONDS = 60;

/**
 * Songs for a typed query. Deezer's own search leaves some real tracks out
 * (Jesus Christ by Brand New is on Deezer, and still absent from its results).
 * The ISRC lets us look that recording up on Deezer anyway.
 * Throws if Spotify is down, so a hiccup is not saved as "no songs".
 */
export const searchSpotifyTracks = unstable_cache(
  lookupSpotifyTracks,
  ["spotify-track-search"],
  { revalidate: SEARCH_CACHE_SECONDS },
);

async function lookupSpotifyTracks(query: string): Promise<SpotifyTrackHit[]> {
  const token = await getSpotifyAppToken();
  let lastStatus = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await wait(200);

    const result = await requestSpotifyTracks(token, query);
    if (result.status === "ok") return result.tracks;
    lastStatus = result.status;
  }

  throw new Error(`Spotify song search failed (${lastStatus}).`);
}

type TrackSearchResult =
  | { status: "ok"; tracks: SpotifyTrackHit[] }
  | { status: number };

async function requestSpotifyTracks(
  token: string,
  query: string,
): Promise<TrackSearchResult> {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "8");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status >= 500 && response.status <= 504) {
    return { status: response.status };
  }

  if (!response.ok) {
    throw new Error(`Spotify song search failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    tracks?: {
      items?: Array<{
        name?: string;
        external_ids?: { isrc?: string };
        artists?: Array<{ name?: string }>;
      }>;
    };
  };

  const tracks: SpotifyTrackHit[] = [];
  for (const item of data.tracks?.items ?? []) {
    const isrc = item.external_ids?.isrc?.trim();
    const title = item.name?.trim();
    const artistName = (item.artists ?? [])
      .map((artist) => artist.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    if (!isrc || !title || !artistName) continue;
    tracks.push({ title, artistName, isrc });
  }

  return { status: "ok", tracks };
}
