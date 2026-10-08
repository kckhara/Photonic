import { getArtistTopSong, getDeezerTrack } from "@/lib/deezer";
import { findSpotifyTrackIdByIsrc } from "@/lib/spotify";
import { type NextRequest } from "next/server";

/**
 * GET /api/playback-ids?songs=1,2&artists=3
 *
 * Spotify track ids for the current search rows. The phone preloads
 * those embeds so a tap can start playback immediately. Failures become
 * null — the player still loads the song the usual way.
 */

const MAX_SONGS = 6;
const MAX_ARTISTS = 3;

export async function GET(request: NextRequest) {
  const songs = cleanIds(request.nextUrl.searchParams.get("songs"), MAX_SONGS);
  const artists = cleanIds(request.nextUrl.searchParams.get("artists"), MAX_ARTISTS);

  const [songIds, artistIds] = await Promise.all([
    resolveAll(songs, spotifyForTrack),
    resolveAll(artists, spotifyForArtist),
  ]);

  return Response.json(
    { songs: songIds, artists: artistIds },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}

function cleanIds(value: string | null, max: number): number[] {
  if (!value) return [];

  const ids: number[] = [];
  for (const part of value.split(",")) {
    const id = Number(part);
    if (!Number.isInteger(id) || id <= 0) continue;
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

async function resolveAll(
  ids: number[],
  lookup: (id: number) => Promise<string | null>,
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    ids.map(async (id) => [String(id), await lookup(id)] as const),
  );
  return Object.fromEntries(entries);
}

async function spotifyForTrack(deezerId: number): Promise<string | null> {
  try {
    const track = await getDeezerTrack(deezerId);
    if (!track?.isrc) return null;
    return await findSpotifyTrackIdByIsrc(track.isrc);
  } catch (error) {
    console.error("Playback id lookup failed", error);
    return null;
  }
}

async function spotifyForArtist(artistId: number): Promise<string | null> {
  try {
    const top = await getArtistTopSong(artistId);
    if (!top) return null;
    return await spotifyForTrack(top.deezerId);
  } catch (error) {
    console.error("Artist playback id lookup failed", error);
    return null;
  }
}
