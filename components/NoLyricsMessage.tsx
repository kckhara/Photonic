/**
 * The sentence we show when a song has no lyrics.
 * The homepage keeps it on screen for a few seconds, then the
 * visualizer starts the general (curated) photos on the beat.
 */

// Long enough to read the sentence once.
export const NO_LYRICS_MESSAGE_MS = 3000;

// The exact wording from the plan.
const MESSAGE = "We can't find lyrics, but let's see what happens";

export function NoLyricsMessage() {
  return (
    <p className="text-2xl font-medium leading-snug" role="status">
      {MESSAGE}
    </p>
  );
}
