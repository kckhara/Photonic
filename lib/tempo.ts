/**
 * Tempo and photo timing. Deezer's bpm number is sometimes missing or
 * doubled/halved. The cleanup, the beat length, how long each photo stays,
 * and the crossfade length are the rules from the plan (section 5.4).
 * Which photo to show at a moment in the song is section 5.3.
 */

import type { Photo, PlaybackSample, Scene } from "@/lib/types";

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
  // Which photo inside this scene. The % wraps back to the first photo
  // after we've used the last one (a chorus can be longer than 3 pictures).
  const steps = Math.floor((position - scene.startMs) / interval);
  const index = positiveMod(steps, scene.photos.length);
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

    // Stop this line once a full round of its photos adds nothing new.
    let repeats = 0;
    for (let step = fromStep; step <= throughStep && srcs.length < count; step += 1) {
      const before = srcs.length;
      addUpcoming(
        srcs,
        seen,
        scene.photos[positiveMod(step, scene.photos.length)],
        count,
      );
      repeats = srcs.length === before ? repeats + 1 : 0;
      if (repeats >= scene.photos.length) break;
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

function positiveMod(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
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
