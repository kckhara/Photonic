/**
 * Shared shapes for the song data our server sends to the browser.
 * Photos and lyric scenes are added in a later phase.
 */

// How the lyrics arrived, which decides how photos are timed later.
export type LyricsType = "synced" | "plain" | "none";

/**
 * What /api/song/[id] returns in this phase.
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
};
