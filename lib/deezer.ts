/**
 * Deezer helpers. These run on the server only (from app/api/search).
 *
 * Deezer is free and does not need an API key. We still call it from the
 * server so every outside request lives in one place.
 */

// Reuse an identical search for one minute so quick repeats don't ask Deezer again.
const SEARCH_CACHE_SECONDS = 60;

export type SongHit = {
  type: "song";
  id: number;
  title: string;
  artistName: string;
  artworkUrl: string | null;
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
  artist?: { name?: string };
  album?: { cover_small?: string };
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

/**
 * Search Deezer for songs and artists at the same time.
 * Songs are capped at 6 and artists at 3, matching the plan.
 */
export async function searchDeezer(query: string): Promise<{
  songs: SongHit[];
  artists: ArtistHit[];
}> {
  const [tracks, artists] = await Promise.all([
    deezerGet<DeezerTrack>("/search", query, 6),
    deezerGet<DeezerArtist>("/search/artist", query, 3),
  ]);

  return {
    songs: tracks.map(toSong).filter((song) => song !== null),
    artists: artists.map(toArtist).filter((artist) => artist !== null),
  };
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

function toSong(track: DeezerTrack): SongHit | null {
  if (typeof track.id !== "number" || !track.title) return null;

  return {
    type: "song",
    id: track.id,
    title: track.title,
    artistName: track.artist?.name || "Unknown artist",
    artworkUrl: track.album?.cover_small || null,
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
