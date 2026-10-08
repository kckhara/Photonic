/**
 * Deezer helpers. These run on the server only.
 *
 * Deezer is free and does not need an API key. We still call it from the
 * server so every outside request lives in one place.
 */

import {
  comparePlacements,
  songIdentity,
  songMatchScore,
} from "@/lib/search-rank";
import { searchSpotifyTracks, type SpotifyTrackHit } from "@/lib/spotify";

// Reuse an identical search for one minute so quick repeats don't ask Deezer again.
const SEARCH_CACHE_SECONDS = 60;

// Song and artist details change rarely, so keep them for a day.
const ONE_DAY_SECONDS = 86400;

export type SongHit = {
  type: "song";
  id: number;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  // Deezer's length for this recording, in seconds. 0 when it wasn't sent.
  durationSeconds: number;
};

export type ArtistHit = {
  type: "artist";
  id: number;
  name: string;
  artworkUrl: string | null;
};

export type SearchHit = SongHit | ArtistHit;

// Only the Deezer fields we actually use. The real responses include many more.
type DeezerTrack = {
  id?: number;
  title?: string;
  duration?: number;
  artist?: { name?: string };
  album?: { cover_small?: string };
  error?: { message?: string; code?: number };
};

type SongCandidate = {
  id: number;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  durationSeconds: number;
};

type DeezerArtist = {
  id?: number;
  name?: string;
  picture_small?: string;
};

type DeezerList<T> = {
  data?: T[];
  error?: { message?: string };
};

// How many songs and artists the dropdown shows.
const SONG_LIMIT = 6;
const ARTIST_LIMIT = 3;

/**
 * Search Deezer for songs and artists at the same time.
 * Songs are capped at 6 and artists at 3, matching the plan.
 *
 * Deezer's search index skips tracks that are still in the catalog, and it
 * ignores a one-letter typo. Jesus Christ by Brand New and No Hard Feelings
 * by Wolf Alice are both on Deezer, and a text search still misses them.
 * Spotify finds them. Each missing recording is looked up by ISRC and mixed
 * in with Deezer's list. Songs Deezer already ranked stay in that order.
 */
export async function searchDeezer(query: string): Promise<{
  songs: SongHit[];
  artists: ArtistHit[];
}> {
  const [tracks, artists, spotifyTracks] = await Promise.all([
    deezerGet<DeezerTrack>("/search", query, SONG_LIMIT),
    deezerGet<DeezerArtist>("/search/artist", query, ARTIST_LIMIT),
    spotifySongs(query),
  ]);

  const fromDeezer = tracks
    .map(toCandidate)
    .filter((song) => song !== null);
  const fromSpotify = await songsDeezerMissed(query, fromDeezer, spotifyTracks);

  return {
    songs: mergeSongs(query, fromDeezer, fromSpotify).map(toSongHit),
    artists: artists.map(toArtist).filter((artist) => artist !== null),
  };
}

async function spotifySongs(query: string): Promise<SpotifyTrackHit[]> {
  try {
    return await searchSpotifyTracks(query);
  } catch (error) {
    // Deezer's list still shows. A Spotify hiccup should not blank the dropdown.
    console.error("Spotify song search failed", error);
    return [];
  }
}

// Spotify can name several missing songs. Each one needs a Deezer lookup.
const SPOTIFY_LOOKUPS = 6;

type PlacedSong = SongCandidate & {
  deezerIndex: number | null;
  spotifyIndex: number | null;
};

/**
 * Spotify recordings that match the query and are missing from Deezer's
 * list. A typo still counts. Tracks Deezer already returned are skipped,
 * and so is anything less relevant than Deezer's best hit.
 */
async function songsDeezerMissed(
  query: string,
  deezerSongs: SongCandidate[],
  spotifyTracks: SpotifyTrackHit[],
): Promise<PlacedSong[]> {
  const best = deezerSongs.reduce(
    (highest, song) =>
      Math.max(highest, songMatchScore(query, song.title, song.artistName)),
    0,
  );
  const seen = new Set(
    deezerSongs.map((song) => songIdentity(song.title, song.artistName)),
  );

  const missing: Array<{ track: SpotifyTrackHit; spotifyIndex: number }> = [];
  spotifyTracks.forEach((track, spotifyIndex) => {
    if (missing.length >= SPOTIFY_LOOKUPS) return;
    const key = songIdentity(track.title, track.artistName);
    if (seen.has(key)) return;
    const score = songMatchScore(query, track.title, track.artistName);
    if (score === 0 || score < best) return;
    seen.add(key);
    missing.push({ track, spotifyIndex });
  });

  const resolved = await Promise.all(
    missing.map(async ({ track, spotifyIndex }) => {
      const song = await candidateFromIsrc(track.isrc);
      if (!song) return null;
      if (songMatchScore(query, song.title, song.artistName) === 0) return null;
      return { ...song, deezerIndex: null, spotifyIndex };
    }),
  );

  return resolved.filter((song) => song !== null);
}

function mergeSongs(
  query: string,
  deezerSongs: SongCandidate[],
  spotifySongs: PlacedSong[],
): SongCandidate[] {
  const placed: PlacedSong[] = deezerSongs.map((song, deezerIndex) => ({
    ...song,
    deezerIndex,
    spotifyIndex: null,
  }));
  const seenIds = new Set(placed.map((song) => song.id));

  for (const song of spotifySongs) {
    if (seenIds.has(song.id)) continue;
    seenIds.add(song.id);
    placed.push(song);
  }

  placed.sort((a, b) =>
    comparePlacements(
      {
        score: songMatchScore(query, a.title, a.artistName),
        deezerIndex: a.deezerIndex,
        spotifyIndex: a.spotifyIndex,
      },
      {
        score: songMatchScore(query, b.title, b.artistName),
        deezerIndex: b.deezerIndex,
        spotifyIndex: b.spotifyIndex,
      },
    ),
  );

  return placed.slice(0, SONG_LIMIT);
}

async function candidateFromIsrc(isrc: string): Promise<SongCandidate | null> {
  const code = isrc.toUpperCase();
  if (!/^[A-Z0-9]{10,15}$/.test(code)) return null;

  try {
    const body = await deezerFetchJson<DeezerTrack>(
      `https://api.deezer.com/track/isrc:${code}`,
    );
    if (body.error) {
      if (body.error.code === 800) return null;
      throw new Error(body.error.message || "Deezer ISRC lookup failed.");
    }
    return toCandidate(body);
  } catch (error) {
    console.error("Deezer ISRC lookup failed", error);
    return null;
  }
}

async function deezerGet<T>(
  path: string,
  query: string,
  limit: number,
): Promise<T[]> {
  const url = new URL(`https://api.deezer.com${path}`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    next: { revalidate: SEARCH_CACHE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Deezer search failed (${response.status}).`);
  }

  const body = (await response.json()) as DeezerList<T>;

  // Deezer sometimes reports a problem inside a normal-looking response.
  if (body.error) {
    throw new Error(body.error.message || "Deezer search failed.");
  }

  return body.data ?? [];
}

function toCandidate(track: DeezerTrack): SongCandidate | null {
  if (typeof track.id !== "number" || !track.title) return null;

  return {
    id: track.id,
    title: track.title,
    artistName: track.artist?.name || "Unknown artist",
    artworkUrl: track.album?.cover_small || null,
    durationSeconds: typeof track.duration === "number" ? track.duration : 0,
  };
}

function toSongHit(song: SongCandidate): SongHit {
  return {
    type: "song",
    id: song.id,
    title: song.title,
    artistName: song.artistName,
    artworkUrl: song.artworkUrl,
    durationSeconds: song.durationSeconds,
  };
}

function toArtist(artist: DeezerArtist): ArtistHit | null {
  if (typeof artist.id !== "number" || !artist.name) return null;

  return {
    type: "artist",
    id: artist.id,
    name: artist.name,
    artworkUrl: artist.picture_small || null,
  };
}

// Fields we need from one track. Deezer sends many more.
export type DeezerTrackDetails = {
  id: number;
  title: string;
  artistName: string;
  artistUrl: string;
  albumTitle: string;
  // Largest album cover Deezer has. Empty when the track has no artwork.
  albumCoverUrl: string;
  durationSeconds: number;
  // null when Deezer didn't send a tempo. 0 is kept so cleanBpm can replace it.
  bpm: number | null;
  isrc: string | null;
};

export type ArtistTopSong = {
  deezerId: number;
  title: string;
  artist: string;
};

type DeezerTrackDetailsResponse = {
  id?: number;
  title?: string;
  duration?: number;
  bpm?: number;
  isrc?: string;
  artist?: { name?: string; link?: string };
  album?: {
    title?: string;
    cover_xl?: string;
    cover_big?: string;
    cover_medium?: string;
  };
  error?: { message?: string; code?: number };
};

type DeezerTopResponse = {
  data?: Array<{
    id?: number;
    title?: string;
    artist?: { name?: string };
  }>;
  error?: { message?: string; code?: number };
};

/**
 * Full details for one Deezer track: title, artist, length, tempo, and ISRC.
 * Returns null when that id doesn't exist.
 */
export async function getDeezerTrack(
  id: number,
): Promise<DeezerTrackDetails | null> {
  const body = await deezerFetchJson<DeezerTrackDetailsResponse>(
    `https://api.deezer.com/track/${id}`,
  );

  if (body.error) {
    // Deezer uses code 800 for "no data" instead of a normal 404.
    if (body.error.code === 800) return null;
    throw new Error(body.error.message || "Deezer track lookup failed.");
  }

  if (typeof body.id !== "number" || !body.title) return null;

  return {
    id: body.id,
    title: body.title,
    artistName: body.artist?.name || "Unknown artist",
    artistUrl: body.artist?.link || "",
    albumTitle: body.album?.title || "",
    albumCoverUrl:
      body.album?.cover_xl ||
      body.album?.cover_big ||
      body.album?.cover_medium ||
      "",
    durationSeconds: typeof body.duration === "number" ? body.duration : 0,
    bpm: typeof body.bpm === "number" ? body.bpm : null,
    isrc: body.isrc || null,
  };
}

/**
 * The artist's most popular song on Deezer (one track).
 * Returns null when the artist doesn't exist or has no songs.
 */
export async function getArtistTopSong(
  artistId: number,
): Promise<ArtistTopSong | null> {
  const body = await deezerFetchJson<DeezerTopResponse>(
    `https://api.deezer.com/artist/${artistId}/top?limit=1`,
  );

  if (body.error) {
    if (body.error.code === 800) return null;
    throw new Error(body.error.message || "Deezer artist lookup failed.");
  }

  const track = body.data?.[0];
  if (!track || typeof track.id !== "number" || !track.title) return null;

  return {
    deezerId: track.id,
    title: track.title,
    artist: track.artist?.name || "Unknown artist",
  };
}

async function deezerFetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: ONE_DAY_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Deezer request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}
