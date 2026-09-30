/**
 * Shared shapes for the song data our server sends to the browser.
 * These match the song package in the plan (section 5.1).
 */

// How the lyrics arrived, which decides how photos are timed.
export type LyricsType = "synced" | "plain" | "none";

// One photograph from Pexels. The browser uses this later for the visuals
// and the credits screen. It does not include our API key.
export type Photo = {
  id: number;
  // Large image URL from Pexels.
  src: string;
  alt: string;
  // Pexels sends this. Use it as a placeholder color while the image loads.
  avgColor: string;
  photographer: string;
  photographerUrl: string;
  // The photo's page on Pexels.
  pexelsUrl: string;
};

/**
 * One landscape video from Pexels. Phase 9B.
 * The browser plays `src` muted. It does not include our API key.
 */
export type VideoClip = {
  id: number;
  // Mp4 file, chosen on the server (wide, and not huge).
  src: string;
  // A still frame. Shown while the file is still downloading.
  poster: string;
  width: number;
  height: number;
  // How long the file is, in milliseconds.
  durationMs: number;
  videographer: string;
  videographerUrl: string;
  // The clip's page on Pexels.
  pexelsUrl: string;
};

/**
 * What the full-screen picture is made of. Remembered until the tab closes.
 * - photos: still pictures, as before
 * - video: a clip per scene, with photos where Pexels had no clip
 * - mix: clips only on words that repeat (a chorus); everything else stays photos
 */
export type VisualMode = "photos" | "video" | "mix";

/**
 * Whether playback pictures are black and white or in color.
 * Remembered until the tab closes. Black and white is the default.
 */
export type ColorMode = "bw" | "color";

// A stretch of the song that shares one picture-word.
export type Scene = {
  // When this scene begins and ends, in milliseconds.
  startMs: number;
  endMs: number;
  keyword: string;
  // One landscape photo for each time the picture changes. Not repeated later in the song.
  photos: Photo[];
  // One landscape clip for this word. Null when Pexels had no wide clip —
  // the photos above stay on screen for that stretch.
  video?: VideoClip | null;
  // How many lyric lines used this word. Mix mode plays a clip only when
  // this is more than one (the word comes back, like a chorus).
  keywordMentions?: number;
  // The opening card before the first lyric. It has no photos.
  titleCard?: boolean;
};

/**
 * What /api/song/[id] returns.
 * spotifyId is null when we could not attach a Spotify track.
 * spotifyLookup says whether that was a real miss or Spotify being down.
 */
export type SpotifyLookup = "missing" | "failed";

export type SongPackage = {
  deezerId: number;
  spotifyId: string | null;
  // Set only when spotifyId is null. "missing" means Spotify has no match.
  // "failed" means the search itself failed, so the song may still be there.
  spotifyLookup?: SpotifyLookup;
  title: string;
  artist: string;
  // Deezer page for the musician. The credits screen links here.
  artistUrl: string;
  // Large album cover from Deezer (cover_xl). Empty when Deezer didn't send one.
  albumCoverUrl: string;
  // Length of the song in milliseconds (1 second = 1000).
  durationMs: number;
  // Tempo after the cleanup rules in lib/tempo.ts.
  bpm: number;
  lyricsType: LyricsType;
  scenes: Scene[];
};

/**
 * One reading from the Spotify player.
 * The player reports this about once a second. The visualizer uses it
 * to keep the photos in time between those reports.
 */
export type PlaybackSample = {
  /** Where Spotify said the song was, in milliseconds. */
  positionMs: number;
  /** True only while the song is actually moving forward. */
  isPlaying: boolean;
  /**
   * True when Spotify says the song is paused.
   * A brief buffer is not a pause. The preview-end check uses this
   * so a loading hiccup doesn't look like the clip finished.
   */
  isPaused: boolean;
  /**
   * When this reading arrived, from performance.now().
   * Used to guess how far the song has moved since then.
   */
  receivedAt: number;
  /**
   * How long Spotify says this playback is, in milliseconds.
   * A preview is about 30,000. Missing until the player sends a length.
   */
  reportedDurationMs?: number;
};
