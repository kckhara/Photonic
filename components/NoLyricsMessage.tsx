/**
 * The sentence we show when a song has no lyrics.
 * It stays up, on a black screen, for the first 5 seconds of playback,
 * then photos take over. It stays hidden while the song is still
 * waiting for play. Video and Mix stay off without lyrics.
 */

// How far into the song the sentence stays up.
export const NO_LYRICS_INTRO_MS = 5000;

const MESSAGE = "We couldn't find any lyrics, lets see what happens...";

export function NoLyricsMessage() {
  return (
    <p
      className="[font-size:var(--font-size-no-lyrics)] [font-weight:var(--font-weight-no-lyrics)] [line-height:var(--line-height-no-lyrics)] [letter-spacing:var(--letter-spacing-no-lyrics)] [color:var(--color-text-secondary)]"
      role="status"
    >
      {MESSAGE}
    </p>
  );
}
