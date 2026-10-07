/**
 * Preview-mode rules from the plan (section 5.6).
 *
 * Spotify won't tell us if someone is logged in. The embedded player
 * only plays about 30 seconds unless they're logged in with Premium
 * in this browser. We notice that short length and treat it as a preview.
 *
 * No API keys here. "Log in" opens Spotify's own public login page.
 */

// Spotify's preview is about 30 seconds. Anything under this counts as short.
export const PREVIEW_MAX_MS = 35_000;

// Deezer's song length and Spotify's length are rarely identical.
// The real song has to be a few seconds longer than the clip, so a
// tiny mismatch doesn't look like a preview.
const MUST_BE_LONGER_BY_MS = 5_000;

export type PlaybackKind = "unknown" | "preview" | "full";

/**
 * Compare the real song length (from Deezer) with the length Spotify
 * is actually playing.
 * - "preview" — short clip, real song is longer
 * - "full" — Spotify is playing the real length
 * - "unknown" — Spotify hasn't reported a length yet
 */
export function classifyPlayback(
  songDurationMs: number,
  reportedDurationMs: number | null | undefined,
): PlaybackKind {
  if (
    reportedDurationMs == null ||
    !Number.isFinite(reportedDurationMs) ||
    reportedDurationMs <= 0
  ) {
    return "unknown";
  }

  const shortClip = reportedDurationMs < PREVIEW_MAX_MS;
  const songIsLonger = songDurationMs > reportedDurationMs + MUST_BE_LONGER_BY_MS;

  if (shortClip && songIsLonger) return "preview";
  return "full";
}

/**
 * Spotify never sends a "this finished" event.
 * Playback counts as finished when the playhead is in the last second
 * and the player has paused, or when it jumps back to the start right
 * after being that close to the end.
 *
 * Pass the length Spotify is actually playing. For a preview that is
 * the short clip. For a full song it is the whole track. The login
 * prompt and the credits screen share this rule so they stay in step.
 */
export function playbackHasEnded(
  positionMs: number,
  durationMs: number,
  isPaused: boolean,
  wasNearEnd: boolean,
): { ended: boolean; nearEnd: boolean } {
  if (!(durationMs > 0) || !Number.isFinite(positionMs)) {
    return { ended: false, nearEnd: false };
  }

  // A pause at the very start is not the end. Only the last second counts.
  const nearEnd = positionMs > 0 && durationMs - positionMs <= 1000;
  const jumpedToStart = wasNearEnd && positionMs < 1000;

  return {
    ended: isPaused && (nearEnd || jumpedToStart),
    nearEnd,
  };
}
