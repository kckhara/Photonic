/**
 * One short style word is added to each scene's photo search.
 * Scenes take the next word in this list, then the list starts over.
 *
 * Edit the list freely. Scene 1 uses the first word, scene 2 the second,
 * and so on.
 */

export const STYLE_WORDS = [
  "moody",
  "dusk",
  "night",
  "silhouette",
  "shadow",
  "texture",
  "fog",
  "light",
  "abstract",
  "film",
];

/** The style word for a scene, based on where it sits in the song. */
export function styleWordAt(sceneIndex: number): string {
  const length = STYLE_WORDS.length;
  const index = ((sceneIndex % length) + length) % length;
  return STYLE_WORDS[index];
}
