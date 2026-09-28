/**
 * Tempo and photo timing. Deezer's bpm number is sometimes missing or
 * doubled/halved. The cleanup, the beat length, how long each photo stays,
 * and the crossfade length are the rules from the plan (section 5.4).
 * Which photo to show at a moment in the song is section 5.3.
 */

import type {
  Photo,
  PlaybackSample,
  Scene,
  VideoClip,
  VisualMode,
} from "@/lib/types";

const DEFAULT_BPM = 120;

/** One beat, in milliseconds. There are 60,000 milliseconds in a minute. */
export function beatMs(bpm: number): number {
  const safe = usableBpm(bpm);
  return 60000 / safe;
}

/**
 * How long each photo stays on screen.
 * Usually one bar (4 beats). Slow songs — under 90 bpm — hold for 8 beats.
 */
export function imageIntervalMs(bpm: number): number {
  const safe = usableBpm(bpm);
  const beatsPerPhoto = safe < 90 ? 8 : 4;
  return beatsPerPhoto * beatMs(safe);
}

/**
 * How long the dissolve between photos takes: one beat.
 * Kept between 150ms and 1200ms so slow songs don't fade forever
 * and fast songs don't flicker.
 */
export function crossfadeMs(bpm: number): number {
  return Math.min(1200, Math.max(150, beatMs(bpm)));
}

/**
 * Where the song is right now.
 * Spotify only speaks up about once a second. While the song is playing,
 * add the time that has passed since that report. While paused, stay put.
 */
export function estimatePositionMs(
  sample: PlaybackSample | null,
  now = typeof performance !== "undefined" ? performance.now() : 0,
): number {
  if (!sample) return 0;

  const position = Number.isFinite(sample.positionMs) ? sample.positionMs : 0;
  if (!sample.isPlaying) return Math.max(0, position);

  const clock = Number.isFinite(now) ? now : sample.receivedAt;
  const elapsed = Math.max(0, clock - sample.receivedAt);
  return Math.max(0, position + elapsed);
}

/**
 * How many times the photo will change during this stretch of the song.
 * One photo per interval, including the photo at the start of the stretch.
 */
export function photoSlotCount(
  startMs: number,
  endMs: number,
  bpm: number,
): number {
  const interval = imageIntervalMs(bpm);
  const span = Math.max(0, endMs - startMs);
  if (!(interval > 0)) return 1;
  return Math.floor(Math.max(0, span - 1) / interval) + 1;
}

/** The photo that should be on screen at this moment, if there is one. */
export function frameAtPosition(
  scenes: Scene[],
  positionMs: number,
  bpm: number,
): { photo: Photo; keyword: string } | null {
  if (scenes.length === 0 || !Number.isFinite(positionMs)) return null;

  let position = positionMs;
  let scene = sceneContaining(scenes, position);

  if (!scene) {
    const last = scenes[scenes.length - 1];
    // Past the end of the song, keep the final photo up instead of going blank.
    if (position >= last.endMs && last.photos.length > 0) {
      scene = last;
      position = Math.max(last.startMs, last.endMs - 1);
    } else {
      return null;
    }
  }

  if (scene.photos.length === 0) return null;

  const interval = imageIntervalMs(bpm);
  // Which photo inside this scene. Walk forward only. Never go back to
  // an earlier photo in the same scene. If we run out, hold the last one.
  const steps = Math.floor((position - scene.startMs) / interval);
  const index = Math.min(Math.max(0, steps), scene.photos.length - 1);
  const photo = scene.photos[index];
  if (!photo) return null;

  return { photo, keyword: scene.keyword };
}

/**
 * The next few photo files we'll need, not including the one already showing.
 * Walks the song the same way the screen does: beat by beat inside a lyric
 * line, then on to the next line. A repeated photo is skipped — it's already
 * downloaded. The browser fetches these early so the dissolve doesn't wait.
 */
export function upcomingPhotoSrcs(
  scenes: Scene[],
  positionMs: number,
  bpm: number,
  count = 3,
): string[] {
  const srcs: string[] = [];
  const seen = new Set<string>();
  const current = frameAtPosition(scenes, positionMs, bpm);
  if (current) seen.add(current.photo.src);

  const interval = imageIntervalMs(bpm);

  for (const scene of scenes) {
    if (srcs.length >= count) break;
    if (scene.photos.length === 0) continue;
    // This line is already over.
    if (scene.endMs <= positionMs) continue;

    // Inside the current line, start at the next photo. Future lines start
    // at their first photo. lastStep is the last one that fits before the line ends.
    const fromStep =
      positionMs > scene.startMs
        ? Math.floor((positionMs - scene.startMs) / interval) + 1
        : 0;
    const throughStep = Math.floor(
      Math.max(0, scene.endMs - 1 - scene.startMs) / interval,
    );

    for (let step = fromStep; step <= throughStep && srcs.length < count; step += 1) {
      const index = Math.min(step, scene.photos.length - 1);
      const before = srcs.length;
      addUpcoming(srcs, seen, scene.photos[index], count);
      // The last photo is already queued. Later beats hold it, so stop.
      if (srcs.length === before) break;
    }
  }

  return srcs;
}

function usableBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return DEFAULT_BPM;
  return bpm;
}

function sceneContaining(scenes: Scene[], positionMs: number): Scene | null {
  for (const scene of scenes) {
    if (positionMs >= scene.startMs && positionMs < scene.endMs) return scene;
  }
  return null;
}

/**
 * The scene for this moment in the song.
 * After the song ends, the last scene stays so the screen doesn't go blank.
 */
export function sceneAtPosition(
  scenes: Scene[],
  positionMs: number,
): Scene | null {
  if (scenes.length === 0 || !Number.isFinite(positionMs)) return null;

  const found = sceneContaining(scenes, positionMs);
  if (found) return found;

  const last = scenes[scenes.length - 1];
  if (positionMs >= last.endMs) return last;
  return null;
}

/**
 * True when this scene should play its clip.
 * Photos mode never does. Video mode does whenever a clip exists.
 * Mix mode only does when the word shows up on more than one lyric line.
 */
export function sceneShowsClip(scene: Scene, mode: VisualMode): boolean {
  if (mode === "photos" || scene.titleCard) return false;

  const clip = scene.video;
  if (!clip?.src || !(clip.durationMs > 0)) return false;
  if (mode === "video") return true;

  // Mix: a chorus (the word comes back). A one-off word stays a photo.
  return (scene.keywordMentions ?? 1) > 1;
}

/**
 * Which moment of the clip to show, in seconds.
 *
 * It is how far the song is into this scene, not a random spot in the
 * file. If the clip is shorter than the scene, it loops. Pause and
 * skip call this again, so they land on the same frame every time.
 *
 * Once the file has loaded, pass its real length. Pexels rounds the
 * length to whole seconds, and seeking past the real end would fail.
 */
export function clipTimeSeconds(
  scene: Scene,
  positionMs: number,
  fileDurationSec?: number,
): number {
  const fromApi = (scene.video?.durationMs ?? 0) / 1000;
  const durationSec =
    fileDurationSec != null &&
    Number.isFinite(fileDurationSec) &&
    fileDurationSec > 0
      ? fileDurationSec
      : fromApi;

  if (!(durationSec > 0)) return 0;

  const elapsedMs = positionMs - scene.startMs;
  const spanMs = Math.max(0, scene.endMs - scene.startMs);
  // Hold the last moment of the scene once the song has moved past it.
  const intoMs = Math.min(Math.max(0, elapsedMs), Math.max(0, spanMs - 1));
  return (intoMs / 1000) % durationSec;
}

/**
 * The next clip we should download, and only that one.
 * Large files: fetching several at once would stall a slow connection.
 * Skips the clip already on screen.
 */
export function upcomingClip(
  scenes: Scene[],
  positionMs: number,
  mode: VisualMode,
): VideoClip | null {
  const current = sceneAtPosition(scenes, positionMs);
  const showing =
    current && sceneShowsClip(current, mode) ? current.video : null;

  for (const scene of scenes) {
    if (scene.endMs <= positionMs) continue;
    if (!sceneShowsClip(scene, mode) || !scene.video) continue;
    if (showing && scene.video.id === showing.id) continue;
    return scene.video;
  }

  return null;
}

function addUpcoming(
  srcs: string[],
  seen: Set<string>,
  photo: Photo | undefined,
  count: number,
) {
  if (!photo || srcs.length >= count || seen.has(photo.src)) return;
  seen.add(photo.src);
  srcs.push(photo.src);
}

/**
 * Turn a raw Deezer tempo into a usable beats-per-minute number.
 * - missing, 0, or negative → 120
 * - above 170 → cut in half (often stored at double speed)
 * - below 70 → double it (often stored at half speed)
 * Each adjustment happens once, then we round to a whole number.
 */
export function cleanBpm(rawBpm: number | null | undefined): number {
  if (rawBpm == null || !Number.isFinite(rawBpm) || rawBpm <= 0) {
    return DEFAULT_BPM;
  }

  let bpm = rawBpm;

  if (bpm > 170) {
    bpm = bpm / 2;
  }

  if (bpm < 70) {
    bpm = bpm * 2;
  }

  return Math.round(bpm);
}
