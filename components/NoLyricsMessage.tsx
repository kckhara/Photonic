/**
 * The sentence we show when a song has no lyrics.
 * It stays up, on a black screen, for the first 5 seconds of the song.
 * After that, photos take over. Video and Mix stay off without lyrics.
 */

// How far into the song the sentence stays up.
export const NO_LYRICS_INTRO_MS = 5000;

const MESSAGE = "We couldn't find any lyrics, lets see what happens...";

export function NoLyricsMessage() {
  return (
    <p className="text-2xl font-medium leading-snug text-white" role="status">
      {MESSAGE}
    </p>
  );
}
