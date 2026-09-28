import { getDeezerTrack } from "@/lib/deezer";
import { getLyrics } from "@/lib/lrclib";
import { attachPhotos } from "@/lib/pexels";
import { scenesFromLyrics } from "@/lib/scenes";
import { findSpotifyTrackIdByIsrc } from "@/lib/spotify";
import { cleanBpm } from "@/lib/tempo";
import type { Scene, SongPackage } from "@/lib/types";

/**
 * GET /api/song/908604612
 *
 * Builds the song package for one Deezer track id:
 * Deezer details → Spotify id → lyrics → picture-words → Pexels photos.
 * Songs with no usable lyrics get curated photos instead of keyword scenes.
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
    const [spotifyId, lyrics] = await Promise.all([
      track.isrc ? findSpotifyTrackIdByIsrc(track.isrc) : Promise.resolve(null),
      getLyrics({
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle,
        durationSeconds: track.durationSeconds,
      }),
    ]);

    const durationMs = track.durationSeconds * 1000;
    const bpm = cleanBpm(track.bpm);
    const scenes = await scenesWithPhotos(
      scenesFromLyrics({
        lyricsType: lyrics.lyricsType,
        syncedLyrics: lyrics.syncedLyrics,
        plainLyrics: lyrics.plainLyrics,
        durationMs,
      }),
      durationMs,
      bpm,
    );

    const song: SongPackage = {
      deezerId: track.id,
      spotifyId,
      title: track.title,
      artist: track.artistName,
      artistUrl: track.artistUrl,
      albumCoverUrl: track.albumCoverUrl,
      durationMs,
      bpm,
      lyricsType: lyrics.lyricsType,
      scenes,
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

/**
 * Each scene gets a new photo every time the picture will change.
 * A photo is not repeated in the same song.
 * No scenes means the lyrics had nothing to picture, so use curated photos.
 */
async function scenesWithPhotos(
  drafts: Scene[],
  durationMs: number,
  bpm: number,
): Promise<Scene[]> {
  if (drafts.length > 0) return attachPhotos(drafts, bpm);

  const [scene] = await attachPhotos(
    [
      {
        startMs: 0,
        endMs: Math.max(0, durationMs),
        keyword: "",
        photos: [],
      },
    ],
    bpm,
  );

  if (!scene || scene.photos.length === 0) return [];
  return [scene];
}
