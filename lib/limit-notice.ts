/**
 * The line we show when Unsplash answers 403 or Pexels answers 429
 * and this stretch has nothing to play. A clip or a photo that did
 * load stays clear — one provider refusing does not cover the other.
 */

import { sceneShowsClip } from "@/lib/tempo";
import type { Scene, SongPackage, VisualMode } from "@/lib/types";

export const QUOTA_NOTICE =
  "We exceeded our quota for image requests. Please try again in an hour. Sorry!";

/**
 * The quota sentence for this moment, or null when a picture or clip
 * is actually on screen. An empty scene after a cap holds the previous
 * photo. A missing clip is mentioned only in Video or Mix, and only on
 * a line that would have played one.
 */
export function mediaLimitNotice(
  song: Pick<SongPackage, "photosLimited" | "videosLimited" | "quotaExceeded">,
  scene: Scene | null,
  mode: VisualMode,
): string | null {
  if (!scene || scene.titleCard || song.quotaExceeded !== true) return null;
  // A clip that loaded is the proof this stretch is not stuck.
  if (sceneShowsClip(scene, mode)) return null;

  const photosShort =
    song.photosLimited === true && scene.photos.length === 0;
  const videosShort =
    song.videosLimited === true &&
    sceneExpectsClip(scene, mode) &&
    !scene.video?.src;

  if (photosShort || videosShort) return QUOTA_NOTICE;
  return null;
}

/** Video mode wants a clip for every word. Mix wants one only when the word returns. */
function sceneExpectsClip(scene: Scene, mode: VisualMode): boolean {
  if (mode === "photos" || scene.titleCard) return false;
  if (!scene.keyword.trim()) return false;
  if (mode === "video") return true;
  return (scene.keywordMentions ?? 1) > 1;
}
