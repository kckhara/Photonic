import { getDeezerTrack, type DeezerTrackDetails } from "@/lib/deezer";
import { getLyrics, type Lyrics } from "@/lib/lrclib";
import { attachPhotos, attachVideos, isPexelsBusy } from "@/lib/pexels";
import { scenesFromLyrics } from "@/lib/scenes";
import { findPreviewStartMs } from "@/lib/preview-offset";
import { findSpotifyTrackIdByIsrc } from "@/lib/spotify";
import { cleanBpm } from "@/lib/tempo";
import type { Scene, SongPackage, SpotifyLookup } from "@/lib/types";

/**
 * GET /api/song/908604612
 *
 * Builds the song package for one Deezer track id:
 * Deezer details → Spotify id → lyrics → picture-words → photos from
 * Pexels and Unsplash, then one Pexels video per picture-word. If a video
 * search fails, the photos for that song are kept.
 *
 * Fallbacks (plan section 5, phase 7):
 * - No lyrics, or the lyrics service fails: curated photos, and the page
 *   shows "We couldn't find any lyrics…" on black for the first 5 seconds.
 * - Plain lyrics (no timestamps): picture-words spread across the song.
 * - Missing tempo: 120 bpm.
 * - Spotify has no match: the song still loads, and the player says it can't play.
 * - Spotify's search fails: the song still loads, and the player asks to try again.
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
    const [spotify, lyrics] = await Promise.all([
      lookupSpotify(track.isrc),
      lookupLyrics(track),
    ]);

    const durationMs = track.durationSeconds * 1000;
    // Missing, 0, or nonsense tempo becomes 120. See cleanBpm.
    const bpm = cleanBpm(track.bpm);
    // Ask where the preview starts while photos load. Without a tag in
    // the file, this transcribes the clip once and matches the lyrics.
    const previewPromise = spotify.spotifyId
      ? findPreviewStartMs(
          spotify.spotifyId,
          lyrics.lyricsType === "synced" ? lyrics.syncedLyrics : null,
          durationMs,
        ).catch((error: unknown) => {
          console.error("Preview start lookup failed", error);
          return null;
        })
      : Promise.resolve(null);
    const { scenes, photosBusy, photosLimited, videosLimited, quotaExceeded } =
      await scenesWithPhotos(
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
    const previewStartMs = await previewPromise;

    const song: SongPackage = {
      deezerId: track.id,
      spotifyId: spotify.spotifyId,
      spotifyLookup: spotify.spotifyLookup,
      title: track.title,
      artist: track.artistName,
      artistUrl: track.artistUrl,
      albumCoverUrl: track.albumCoverUrl,
      durationMs,
      bpm,
      ...(previewStartMs != null ? { previewStartMs } : {}),
      lyricsType: lyrics.lyricsType,
      scenes,
      ...(photosBusy ? { photosBusy: true } : {}),
      ...(photosLimited ? { photosLimited: true } : {}),
      ...(videosLimited ? { videosLimited: true } : {}),
      ...(quotaExceeded ? { quotaExceeded: true } : {}),
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
 * Spotify id for this song.
 * A failure here must not throw — the page explains a missing player,
 * and a search outage is not the same as "this song isn't on Spotify".
 */
async function lookupSpotify(isrc: string | null): Promise<{
  spotifyId: string | null;
  spotifyLookup?: SpotifyLookup;
}> {
  if (!isrc) return { spotifyId: null, spotifyLookup: "missing" };

  try {
    const spotifyId = await findSpotifyTrackIdByIsrc(isrc);
    if (!spotifyId) return { spotifyId: null, spotifyLookup: "missing" };
    return { spotifyId };
  } catch (error) {
    console.error("Spotify lookup failed", error);
    return { spotifyId: null, spotifyLookup: "failed" };
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
): Promise<{
  scenes: Scene[];
  photosBusy: boolean;
  photosLimited: boolean;
  videosLimited: boolean;
  quotaExceeded: boolean;
}> {
  try {
    return await fillScenes(drafts, durationMs, bpm);
  } catch (error) {
    // A bad Pexels key, a Pexels outage, or the hourly limit.
    // Return no photos so the page can say so, and still play the song.
    console.error("Photo lookup failed", error);
    const limited = isPexelsBusy(error);
    return {
      scenes: [],
      photosBusy: limited,
      photosLimited: limited,
      videosLimited: false,
      quotaExceeded: limited,
    };
  }
}

async function fillScenes(
  drafts: Scene[],
  durationMs: number,
  bpm: number,
): Promise<{
  scenes: Scene[];
  photosBusy: boolean;
  photosLimited: boolean;
  videosLimited: boolean;
  quotaExceeded: boolean;
}> {
  const photos = await photosForScenes(drafts, durationMs, bpm);
  const photosBusy =
    photos.limited && photos.scenes.every((scene) => scene.photos.length === 0);

  if (photos.scenes.length === 0) {
    return {
      scenes: [],
      photosBusy,
      photosLimited: photos.limited,
      videosLimited: false,
      quotaExceeded: photos.limited || photos.unsplashQuota,
    };
  }

  // Clips share Pexels' hourly limit with the photos. Asking for both at
  // once makes Pexels refuse the rest of the song, and a scene with no
  // photo then holds whatever picture is already on screen. Photos go
  // first. A video failure keeps the photos.
  try {
    const videos = await attachVideos(drafts);
    const scenes =
      videos.scenes.length === photos.scenes.length
        ? photos.scenes.map((scene, index) => ({
            ...scene,
            video: videos.scenes[index]?.video ?? null,
          }))
        : photos.scenes;
    return {
      scenes,
      photosBusy,
      photosLimited: photos.limited,
      videosLimited: videos.limited,
      quotaExceeded: photos.limited || photos.unsplashQuota || videos.limited,
    };
  } catch (error) {
    console.error("Video lookup failed", error);
    const videosLimited = isPexelsBusy(error);
    return {
      scenes: photos.scenes,
      photosBusy,
      photosLimited: photos.limited,
      videosLimited,
      quotaExceeded: photos.limited || photos.unsplashQuota || videosLimited,
    };
  }
}

async function photosForScenes(
  drafts: Scene[],
  durationMs: number,
  bpm: number,
): Promise<{ scenes: Scene[]; limited: boolean; unsplashQuota: boolean }> {
  if (drafts.length > 0) return attachPhotos(drafts, bpm);

  const curated = await attachPhotos(
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
  const scene = curated.scenes[0];

  if (!scene || scene.photos.length === 0) {
    return {
      scenes: [],
      limited: curated.limited,
      unsplashQuota: curated.unsplashQuota,
    };
  }
  return curated;
}
