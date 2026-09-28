import { getDeezerTrack, type DeezerTrackDetails } from "@/lib/deezer";
import { getLyrics, type Lyrics } from "@/lib/lrclib";
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
 *
 * Fallbacks (plan section 5, phase 7):
 * - No lyrics, or the lyrics service fails: curated photos, and the page
 *   shows "We couldn't find any lyrics…" on black for the first 5 seconds.
 * - Plain lyrics (no timestamps): picture-words spread across the song.
 * - Missing tempo: 120 bpm.
 * - Spotify fails: the song still loads, and the player says it can't play.
 * - Photos fail: the song still loads, and the page says the photos didn't.
 * The browser only ever receives a short friendly error, never a raw one.
 */

// Used when LRCLIB has nothing, or when the lyrics request itself fails.
const MISSING_LYRICS: Lyrics = {
  lyricsType: "none",
  syncedLyrics: null,
  plainLyrics: null,
};

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
        { error: "We couldn’t find that song. Try another search." },
        { status: 404 },
      );
    }

    // Spotify and lyrics don't depend on each other, so ask both at once.
    // If either one fails, we still return the song.
    const [spotifyId, lyrics] = await Promise.all([
      lookupSpotifyId(track.isrc),
      lookupLyrics(track),
    ]);

    const durationMs = track.durationSeconds * 1000;
    // Missing, 0, or nonsense tempo becomes 120. See cleanBpm.
    const bpm = cleanBpm(track.bpm);
    const scenes = await scenesWithPhotos(
      // Plain lyrics are spread evenly in here. No lyrics comes back empty,
      // and scenesWithPhotos fills that with curated photos.
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
    // Deezer failed, or something else we can't work around.
    // The details stay in the terminal. The page gets one plain sentence.
    console.error("Song package failed", error);
    return Response.json(
      { error: "We couldn’t load this song. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * Spotify id for this song, or null if Spotify has no match or is down.
 * A failure here must not throw — the page already explains a missing player.
 */
async function lookupSpotifyId(isrc: string | null): Promise<string | null> {
  if (!isrc) return null;

  try {
    return await findSpotifyTrackIdByIsrc(isrc);
  } catch (error) {
    console.error("Spotify lookup failed", error);
    return null;
  }
}

/**
 * Lyrics for this song. If the lyrics service is down, treat it like
 * an instrumental: no words, and the page will use curated photos.
 */
async function lookupLyrics(track: DeezerTrackDetails): Promise<Lyrics> {
  try {
    return await getLyrics({
      title: track.title,
      artist: track.artistName,
      album: track.albumTitle,
      durationSeconds: track.durationSeconds,
    });
  } catch (error) {
    console.error("Lyrics lookup failed", error);
    return MISSING_LYRICS;
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
  try {
    return await fillScenes(drafts, durationMs, bpm);
  } catch (error) {
    // A bad Pexels key or a Pexels outage. Return no photos so the page
    // can say so, and still play the song.
    console.error("Photo lookup failed", error);
    return [];
  }
}

async function fillScenes(
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
