import { getDeezerTrack } from "@/lib/deezer";
import { getLyricsType } from "@/lib/lrclib";
import { findSpotifyTrackIdByIsrc } from "@/lib/spotify";
import { cleanBpm } from "@/lib/tempo";
import type { SongPackage } from "@/lib/types";

/**
 * GET /api/song/908604612
 *
 * Builds the song details for one Deezer track id:
 * Deezer (title, artist, length, tempo, ISRC) → Spotify id → lyrics type.
 * Keywords and photos are added in a later phase.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deezerId = Number(id);

  if (!Number.isInteger(deezerId) || deezerId <= 0) {
    return Response.json(
      { error: "That doesn’t look like a Deezer song id." },
      { status: 400 },
    );
  }

  try {
    const track = await getDeezerTrack(deezerId);

    if (!track) {
      return Response.json(
        { error: "No song found for that Deezer id." },
        { status: 404 },
      );
    }

    // Spotify and lyrics don't depend on each other, so ask both at once.
    const [spotifyId, lyricsType] = await Promise.all([
      track.isrc ? findSpotifyTrackIdByIsrc(track.isrc) : Promise.resolve(null),
      getLyricsType({
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle,
        durationSeconds: track.durationSeconds,
      }),
    ]);

    const song: SongPackage = {
      deezerId: track.id,
      spotifyId,
      title: track.title,
      artist: track.artistName,
      artistUrl: track.artistUrl,
      durationMs: track.durationSeconds * 1000,
      bpm: cleanBpm(track.bpm),
      lyricsType,
    };

    return Response.json(song);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while loading this song.";
    return Response.json({ error: message }, { status: 500 });
  }
}
