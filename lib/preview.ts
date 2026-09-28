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
const PREVIEW_MAX_MS = 35_000;

// Deezer's song length and Spotify's length are rarely identical.
// The real song has to be a few seconds longer than the clip, so a
// tiny mismatch doesn't look like a preview.
const MUST_BE_LONGER_BY_MS = 5_000;

// "Maybe later" is remembered until this browser tab is closed.
const DISMISS_KEY = "lyric-visualizer:spotify-login-later";

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
 * A preview is over when playback has paused within the last second
 * of the clip, or the playhead jumps back to the start right after
 * being that close to the end. The same idea as the end-of-song rule,
 * but using the clip's length, not the full song's.
 */
export function previewHasEnded(
  positionMs: number,
  durationMs: number,
  isPaused: boolean,
  wasNearEnd: boolean,
): { ended: boolean; nearEnd: boolean } {
  if (!(durationMs > 0) || !Number.isFinite(positionMs)) {
    return { ended: false, nearEnd: false };
  }

  // Not the paused start of the clip. Only the last second counts.
  const nearEnd = positionMs > 0 && durationMs - positionMs <= 1000;
  const jumpedToStart = wasNearEnd && positionMs < 1000;

  return {
    ended: isPaused && (nearEnd || jumpedToStart),
    nearEnd,
  };
}

/** True if they chose "Maybe later" earlier in this visit. */
export function wasLoginPromptDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Hide the automatic prompt until this tab is closed. */
export function rememberLoginPromptDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Some private windows block storage. The prompt still closes
    // for now; it may come back on the next song.
  }
}
