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

// A stretch of the song that shares one picture-word.
export type Scene = {
  // When this scene begins and ends, in milliseconds.
  startMs: number;
  endMs: number;
  keyword: string;
  // Usually 3 landscape photos. Reused when the same word comes back.
  photos: Photo[];
};

/**
 * What /api/song/[id] returns.
 * spotifyId is null when Spotify has no matching track.
 */
export type SongPackage = {
  deezerId: number;
  spotifyId: string | null;
  title: string;
  artist: string;
  // Deezer page for the musician. The credits screen links here later.
  artistUrl: string;
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
   * When this reading arrived, from performance.now().
   * Used to guess how far the song has moved since then.
   */
  receivedAt: number;
};
