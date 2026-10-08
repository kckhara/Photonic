/**
 * The line we show when Unsplash answers 403 or Pexels answers 429.
 * Shown when nothing loaded, and again while a later scene is short
 * a photo or a clip because of that cap.
 */

import { sceneShowsClip } from "@/lib/tempo";
import type { Scene, SongPackage, VisualMode } from "@/lib/types";

export const QUOTA_NOTICE =
  "We exceeded our quota for image requests. Please try again in an hour. Sorry!";

/**
 * The quota sentence for this moment, or null when this stretch still
 * has something to show. An empty scene after a photo cap holds the
 * previous photo. A missing clip after a video cap is mentioned only
 * in Video or Mix, and only on a line that would have played one.
 * An Unsplash 403 is mentioned on those same stretches, and also when
 * the photos that did load are only from Pexels.
 */
export function mediaLimitNotice(
  song: Pick<SongPackage, "photosLimited" | "videosLimited" | "quotaExceeded">,
  scene: Scene | null,
  mode: VisualMode,
): string | null {
  if (!scene || scene.titleCard || song.quotaExceeded !== true) return null;

  const photosShort = scene.photos.length === 0 && !sceneShowsClip(scene, mode);
  const videosShort =
    song.videosLimited === true &&
    sceneExpectsClip(scene, mode) &&
    !scene.video?.src;
  // Unsplash's 403 leaves Pexels photos in place. Say so while those
  // pictures are up, not only after the screen has frozen.
  const unsplashOnly =
    song.photosLimited !== true && song.videosLimited !== true;

  if (photosShort || videosShort || unsplashOnly) return QUOTA_NOTICE;
  return null;
}

/** Video mode wants a clip for every word. Mix wants one only when the word returns. */
function sceneExpectsClip(scene: Scene, mode: VisualMode): boolean {
  if (mode === "photos" || scene.titleCard) return false;
  if (!scene.keyword.trim()) return false;
  if (mode === "video") return true;
  return (scene.keywordMentions ?? 1) > 1;
}
