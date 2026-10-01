"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { classifyPlayback } from "@/lib/preview";
import { beatOnlyScenes, isTitleCardMoment } from "@/lib/scenes";
import {
  clipTimeSeconds,
  crossfadeMs,
  estimatePositionMs,
  frameAtPosition,
  sceneAtPosition,
  sceneShowsClip,
  upcomingClip,
  upcomingPhotoSrcs,
} from "@/lib/tempo";
import type {
  ColorMode,
  Photo,
  PlaybackSample,
  Scene,
  SongPackage,
  VideoClip,
  VisualMode,
} from "@/lib/types";

/**
 * Full-screen photos behind the search bar and player.
 *
 * The picture always comes from where the song is right now — never from
 * a separate clock. That's why pause, rewind, and skip stay in sync.
 * Spotify reports that position about once a second. Between reports we
 * nudge it forward only while the music is actually playing.
 *
 * A lyric line picks the scene. Inside that scene, photos take turns on
 * the beat. Two copies of the photo sit on top of each other so the new
 * one can fade in while the old one is still there (no blank flash).
 * A smaller copy of the same photo can fade in first, while the full
 * file is still downloading, so the screen doesn't sit on empty black.
 * If a file fails, the picture already on screen stays.
 *
 * Before the first photo or clip, a title card shows the album cover
 * and a countdown to that first picture. Pictures and clips wait until
 * then. The card also stays up while the first photo is still downloading.
 * The first photo fades in on top of that card.
 *
 * A song with no lyrics skips the title card. For the first 5 seconds
 * of the song the page holds a black screen and a short sentence
 * (holdPhotos). Photos and video wait, then start from that moment.
 *
 * A Spotify preview is different. The clip is often from the middle of
 * the song, but the clock starts at 0, so lyric times would be wrong.
 * Photos still change on the beat. A song with no lyrics keeps the
 * black screen for the first 5 seconds of that clock, then the photos
 * start. Clips stay off in preview mode: the lyric times wouldn't match.
 *
 * Video mode (and Mix) plays one muted clip per scene. The frame is how
 * far the song is into that scene, looping if the file is shorter.
 * A new clip cuts in when the photos would have moved to the next scene.
 * A long scene keeps its one clip playing — it does not jump back to
 * the start on every beat, or you'd only see the opening seconds.
 * Scenes with no clip keep changing photos on the beat. Only the next
 * clip is downloaded ahead of time.
 *
 * Going from a photo to a clip, or a clip back to a photo, dissolves
 * over one beat — the same length as a photo crossfade. One clip
 * replacing another still cuts, so those shots stay sharp.
 *
 * Black and white covers this whole layer: photos, clips, the standby
 * frame, and the album art on the title card. Color turns that off.
 * Search and the player sit above this layer, so they stay as they are.
 */

type Slide = {
  photo: Photo;
  keyword: string;
  // A new number every time we show a photo, so React keeps the two
  // fading pictures as separate images even if the same photo returns.
  token: number;
  // False until the file has loaded. Then it fades to full strength.
  visible: boolean;
};

export function Visualizer({
  song,
  playback,
  holdPhotos = false,
  previewMode = false,
  visualMode = "photos",
  colorMode = "bw",
  onShownPhotos,
  onShownVideos,
}: {
  song: SongPackage | null;
  playback: PlaybackSample | null;
  // True while the no-lyrics sentence is on screen. Photos wait.
  holdPhotos?: boolean;
  // True while Spotify is playing a 30-second preview. Photos follow
  // the beat instead of the lyric timestamps.
  previewMode?: boolean;
  // Photos, clips, or clips only on repeated words. See the plan, 5.7.
  visualMode?: VisualMode;
  // Black and white, or the photos and clips in their own color.
  colorMode?: ColorMode;
  // Called with every photo that has actually appeared. The credits
  // screen lists those photographers — not photos that only preloaded.
  onShownPhotos?: (photos: Photo[]) => void;
  // Same idea for clips that actually played. Preloaded clips stay off
  // the credits list.
  onShownVideos?: (videos: VideoClip[]) => void;
}) {
  const songRef = useRef(song);
  const playbackRef = useRef(playback);
  const onShownRef = useRef(onShownPhotos);
  const onShownVideosRef = useRef(onShownVideos);
  const holdPhotosRef = useRef(holdPhotos);
  const previewModeRef = useRef(previewMode);
  const visualModeRef = useRef(visualMode);

  const [slides, setSlides] = useState<Slide[]>([]);
  const [shownPhotos, setShownPhotos] = useState<Photo[]>([]);
  const [shownClips, setShownClips] = useState<VideoClip[]>([]);
  // Stays up through the intro and until the first photo has finished fading in.
  const [titleHeld, setTitleHeld] = useState(true);
  // Which of the two clip players is on screen. The other one downloads
  // the next file so the cut doesn't go black.
  const [frontSlot, setFrontSlot] = useState<0 | 1>(0);
  const [clipOnScreen, setClipOnScreen] = useState(false);
  // True when the clip should dissolve. False for one paint when one
  // clip replaces another, so that change stays a cut.
  const [clipFade, setClipFade] = useState(true);
  // Still frame for the clip we're waiting on, when there's no photo yet.
  const [standbyClip, setStandbyClip] = useState<VideoClip | null>(null);
  const slidesRef = useRef(slides);
  const titleHeldRef = useRef(true);
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  // The file each player is holding. Empty until we ask it to download.
  const bufferSrcRef = useRef<[string, string]>(["", ""]);
  const frontSlotRef = useRef<0 | 1>(0);
  const clipOnScreenRef = useRef(false);
  const clipFadeRef = useRef(true);
  // When the current clip first became visible, so the title card can
  // stay up until a dissolve over it has finished.
  const clipShownAtRef = useRef(0);
  const shownClipIdRef = useRef<number | null>(null);
  const standbyIdRef = useRef<number | null>(null);
  const seekCancelRef = useRef<(() => void) | null>(null);
  const seekStartedRef = useRef(0);

  // The animation loop reads these between renders. Update them after
  // each render so the loop sees the latest song and playback position.
  useEffect(() => {
    songRef.current = song;
    playbackRef.current = playback;
    onShownRef.current = onShownPhotos;
    onShownVideosRef.current = onShownVideos;
    slidesRef.current = slides;
    holdPhotosRef.current = holdPhotos;
    previewModeRef.current = previewMode;
    visualModeRef.current = visualMode;
  });

  // Which photo the loop last chose. Undefined until the first choice,
  // so "nothing yet" is different from "no photo at this moment".
  const chosenIdRef = useRef<number | null | undefined>(undefined);
  const skipPreviewReset = useRef(true);
  const skipModeReset = useRef(true);

  // Lyric timing and beat-only timing choose different photos.
  // Forget the last choice so the next frame can switch.
  // Skip the first run so loading a song doesn't restart the fade.
  useEffect(() => {
    if (skipPreviewReset.current) {
      skipPreviewReset.current = false;
      return;
    }
    chosenIdRef.current = undefined;
  }, [previewMode]);

  // Photos, Video, and Mix pick different pictures. Same idea.
  useEffect(() => {
    if (skipModeReset.current) {
      skipModeReset.current = false;
      return;
    }
    chosenIdRef.current = undefined;
  }, [visualMode]);

  const tokenRef = useRef(0);
  const failedClipsRef = useRef<Set<string>>(new Set());
  const revealedRef = useRef<Set<number>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      seekCancelRef.current?.();
      seekCancelRef.current = null;
    };
  }, []);

  useEffect(() => {
    onShownRef.current?.(shownPhotos);
  }, [shownPhotos]);

  useEffect(() => {
    onShownVideosRef.current?.(shownClips);
  }, [shownClips]);

  function holdTitle(next: boolean) {
    if (titleHeldRef.current === next) return;
    titleHeldRef.current = next;
    setTitleHeld(next);
  }

  // Runs every frame. Picks the photo for the current position and,
  // if it changed, starts a fade. Also asks the browser to download
  // the next 3 photos before we need them.
  // In Video or Mix, a clip can cover the photos. While it does, we
  // don't advance the photos underneath — those wouldn't be seen, so
  // they shouldn't land in the credits.
  useEffect(() => {
    let frame = 0;
    // Built once per song, not on every frame.
    let beatSong: SongPackage | null = null;
    let beatScenes: Scene[] = [];
    // True while a clip is covering the photos, so we can catch the
    // picture up when the clip leaves.
    let photosHeld = false;
    // The dissolve-out pause. A newer hide, or the clip coming back,
    // makes the old timer do nothing.
    let hideTimer = 0;
    let hideToken = 0;
    // Where the song is, so a clip can wait until that moment's photo
    // has actually downloaded before it fades away.
    let clockScenes: Scene[] = [];
    let clockPosition = 0;
    let clockBpm = 120;
    // When we first wanted to leave a clip and the photo wasn't ready.
    // After a couple of seconds we fade anyway, so a stuck download
    // can't pin the old clip on screen.
    let clipHoldSince = 0;
    // Last time the on-screen clip's playhead actually moved. A file
    // that sits on one frame would otherwise cover the photos for the
    // rest of the line — the chorus just after 0:40 is where that shows up.
    let clipMovedAt = 0;
    let clipMovedTime = -1;
    let clipMovedSrc = "";

    function videoAt(slot: 0 | 1): HTMLVideoElement | null {
      return slot === 0 ? videoRefA.current : videoRefB.current;
    }

    function cancelSeek() {
      seekCancelRef.current?.();
      seekCancelRef.current = null;
    }

    function pauseVideo(video: HTMLVideoElement | null) {
      if (!video || video.paused) return;
      video.pause();
    }

    // Start a download once. Calling this again with the same file does nothing.
    // Playing it muted is what actually fills the buffer. A clip that only
    // sits on preload often has no frame when we cut to it, and that cut
    // paints black. Once a frame is in, pause the hidden copy so it doesn't
    // keep streaming under the clip people are watching.
    function loadInto(slot: 0 | 1, src: string) {
      if (!src || bufferSrcRef.current[slot] === src) return;
      const video = videoAt(slot);
      if (!video) return;
      cancelSeek();
      bufferSrcRef.current[slot] = src;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onerror = () => {
        if (bufferSrcRef.current[slot] !== src) return;
        failedClipsRef.current.add(src);
        bufferSrcRef.current[slot] = "";
        if (frontSlotRef.current === slot && clipOnScreenRef.current) {
          clipOnScreenRef.current = false;
          setClipOnScreen(false);
          setClipFade(false);
          clipFadeRef.current = false;
        }
      };
      const pump = () => {
        if (!mountedRef.current) return;
        if (bufferSrcRef.current[slot] !== src) return;
        if (video.readyState >= 2) {
          if (frontSlotRef.current !== slot && !video.paused) video.pause();
          return;
        }
        void video.play().catch(() => {
          // Autoplay can wait until the next click. The next frame tries again.
        });
      };
      video.onloadeddata = pump;
      video.src = src;
      video.load();
      pump();
    }

    function showStandby(clip: VideoClip | null) {
      const nextId = clip?.id ?? null;
      if (standbyIdRef.current === nextId) return;
      standbyIdRef.current = nextId;
      setStandbyClip(clip);
    }

    // True once the photo for this moment is decoded, so a clip can
    // fade onto that picture instead of onto the empty background.
    function photoReadyNow(): boolean {
      const next = frameAtPosition(clockScenes, clockPosition, clockBpm);
      if (!next) return true;
      return photoIsReady(next.photo.src);
    }

    // Leave the clip. If one is actually up, dissolve it away over one
    // beat and keep it playing until that finishes. Calling this again
    // on the next frame must not restart that dissolve.
    // keepFrameUntilPhoto holds the last frame while the next photo
    // downloads. Fading earlier is a black flash.
    function hideClip(playing: boolean, keepFrameUntilPhoto = false) {
      if (
        keepFrameUntilPhoto &&
        clipOnScreenRef.current &&
        !photoReadyNow()
      ) {
        if (clipHoldSince === 0) clipHoldSince = performance.now();
        if (performance.now() - clipHoldSince < 2000) {
          if (!playing) {
            pauseVideo(videoRefA.current);
            pauseVideo(videoRefB.current);
          }
          return;
        }
      }
      clipHoldSince = 0;

      cancelSeek();
      showStandby(null);
      shownClipIdRef.current = null;

      if (!clipOnScreenRef.current) {
        if (!playing) {
          pauseVideo(videoRefA.current);
          pauseVideo(videoRefB.current);
        }
        return;
      }

      // Make sure the fade is allowed. A clip-to-clip cut turns it off
      // for one paint, and this change is a photo, not another clip.
      if (!clipFadeRef.current) {
        clipFadeRef.current = true;
        setClipFade(true);
      }
      clipOnScreenRef.current = false;
      setClipOnScreen(false);

      if (!playing) {
        pauseVideo(videoRefA.current);
        pauseVideo(videoRefB.current);
        return;
      }

      const ms = crossfadeMs(songRef.current?.bpm ?? 120);
      const token = ++hideToken;
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!mountedRef.current) return;
        if (token !== hideToken) return;
        if (clipOnScreenRef.current) return;
        pauseVideo(videoRefA.current);
        pauseVideo(videoRefB.current);
      }, ms);
    }

    function markClipShowing(clip: VideoClip) {
      clipHoldSince = 0;
      if (!clipOnScreenRef.current) {
        clipOnScreenRef.current = true;
        setClipOnScreen(true);
        clipShownAtRef.current = performance.now();
      }
      showStandby(null);
      if (shownClipIdRef.current === clip.id) return;
      shownClipIdRef.current = clip.id;
      setShownClips((current) => rememberClip(current, clip));
    }

    // One clip replacing another snaps. A clip arriving over a photo
    // (or the title card) dissolves. Turn the dissolve back on after
    // the snap so the next photo change can fade.
    function armClipChange(fromStill: boolean) {
      if (fromStill) {
        if (!clipFadeRef.current) {
          clipFadeRef.current = true;
          setClipFade(true);
        }
        return;
      }
      clipFadeRef.current = false;
      setClipFade(false);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        clipFadeRef.current = true;
        setClipFade(true);
      });
    }

    // Keep the clip on the frame the song is at. While it plays, only
    // correct a real jump — a skip, or the clip looping back to the start.
    // Seeking for a small drift clears the picture, and the element stays
    // black until that new frame arrives. Spotify's position twitches by
    // less than that about once a second, so those are left alone.
    // Never seek into a part of the file that isn't downloaded yet.
    function syncPlayback(
      video: HTMLVideoElement,
      timeSec: number,
      playing: boolean,
    ) {
      video.muted = true;
      const drift = Math.abs(video.currentTime - timeSec);
      const snap = !playing || drift > PLAYING_SEEK_SEC;
      if (snap && drift > 0.05 && mediaCovers(video, timeSec)) {
        try {
          video.currentTime = timeSec;
        } catch {
          // The file isn't ready to seek yet. The next frame tries again.
        }
      }
      if (playing) {
        if (video.paused) {
          void video.play().catch(() => {
            // Autoplay can be blocked until the next click. We keep trying.
          });
        }
      } else if (!video.paused) {
        video.pause();
      }
    }

    // True when this file has been the one we want, the song is playing,
    // and its frame hasn't moved for a couple of seconds.
    function clipFrameStuck(
      video: HTMLVideoElement,
      src: string,
      playing: boolean,
    ): boolean {
      if (!playing) {
        clipMovedAt = 0;
        return false;
      }
      const time = video.currentTime;
      if (src !== clipMovedSrc || Math.abs(time - clipMovedTime) > 0.05) {
        clipMovedSrc = src;
        clipMovedTime = time;
        clipMovedAt = performance.now();
        return false;
      }
      if (clipMovedAt === 0) clipMovedAt = performance.now();
      return performance.now() - clipMovedAt > 2000;
    }

    function fileDuration(video: HTMLVideoElement | null): number | undefined {
      if (!video) return undefined;
      if (!Number.isFinite(video.duration) || !(video.duration > 0)) {
        return undefined;
      }
      return video.duration;
    }

    // Download the one clip that comes after what's on screen.
    function queueNext(
      scenes: Scene[],
      positionMs: number,
      mode: VisualMode,
      avoidSrc: string,
    ) {
      const next = upcomingClip(scenes, positionMs, mode);
      if (!next || next.src === avoidSrc) return;
      const front = frontSlotRef.current;
      const back: 0 | 1 = front === 0 ? 1 : 0;
      if (bufferSrcRef.current[front] === next.src) return;
      if (bufferSrcRef.current[back] === next.src) return;
      loadInto(back, next.src);
    }

    /**
     * Put the right clip on screen for this moment, muted, on the
     * matching frame. Returns true once that clip is actually visible.
     * Until then the photos (or the title card) stay up, so the screen
     * doesn't flash black.
     */
    function updateClipLayer(
      wanted: VideoClip | null,
      scene: Scene | null,
      positionMs: number,
      playing: boolean,
      scenes: Scene[],
      mode: VisualMode,
    ): boolean {
      clockScenes = scenes;
      clockPosition = positionMs;
      clockBpm = songRef.current?.bpm ?? 120;

      if (!wanted || !scene) {
        hideClip(playing, true);
        queueNext(scenes, positionMs, mode, "");
        return false;
      }

      // This file already failed. Leave it off and let the photos show
      // instead of a black player.
      if (failedClipsRef.current.has(wanted.src)) {
        if (clipFadeRef.current) {
          clipFadeRef.current = false;
          setClipFade(false);
        }
        hideClip(false);
        return false;
      }

      const front = frontSlotRef.current;
      const back: 0 | 1 = front === 0 ? 1 : 0;
      const frontVideo = videoAt(front);
      const backVideo = videoAt(back);
      const timedVideo =
        bufferSrcRef.current[front] === wanted.src
          ? frontVideo
          : bufferSrcRef.current[back] === wanted.src
            ? backVideo
            : null;
      const timeSec = clipTimeSeconds(
        scene,
        positionMs,
        fileDuration(timedVideo),
      );

      // Right file, but the first frame isn't here yet. Keep the photo
      // (or the still) up. Don't start a second download of the same file.
      // If this player was already covering the screen, take it off —
      // an empty video paints black and hides the photo underneath.
      if (frontVideo && bufferSrcRef.current[front] === wanted.src) {
        if (frontVideo.readyState < 2) {
          showStandby(wanted);
          if (clipOnScreenRef.current) {
            clipOnScreenRef.current = false;
            setClipOnScreen(false);
          }
          return false;
        }

        const drift = Math.abs(frontVideo.currentTime - timeSec);
        // A skip or a loop into a part we haven't downloaded. Hide the
        // clip and seek while the photo is up, so the seek doesn't flash black.
        // A small pause correction stays on the frame that's already showing.
        if (drift > PLAYING_SEEK_SEC && !mediaCovers(frontVideo, timeSec)) {
          showStandby(wanted);
          if (clipOnScreenRef.current) {
            clipOnScreenRef.current = false;
            setClipOnScreen(false);
          }
          if (!frontVideo.seeking && frontVideo.readyState >= 1) {
            try {
              frontVideo.currentTime = timeSec;
            } catch {
              // The next frame tries again.
            }
          }
          return false;
        }

        cancelSeek();
        syncPlayback(frontVideo, timeSec, playing);
        if (clipFrameStuck(frontVideo, wanted.src, playing)) {
          // Play was asked for, and the frame still hasn't moved.
          // Drop the still and let photos keep changing.
          hideClip(playing, true);
          return false;
        }
        pauseVideo(backVideo);
        // Same clip, still on this player. Opacity stays with React so a
        // dissolve that just started can finish. A swap onto the other
        // player is handled in cut(), below.
        markClipShowing(wanted);
        queueNext(scenes, positionMs, mode, wanted.src);
        return true;
      }

      // The other player already has this file. Seek it to the right
      // frame first, then bring it on — so we don't flash the first frame.
      // A photo underneath gets a dissolve. Another clip gets a cut.
      if (backVideo && bufferSrcRef.current[back] === wanted.src) {
        if (backVideo.readyState < 2) {
          showStandby(wanted);
          // Not showable yet. Leave the photos free to keep changing.
          // Pausing the clip that's up pins one frame on screen — the
          // chorus around 0:40 is where that next file is often still
          // downloading.
          hideClip(playing, true);
          return false;
        }

        const cut = () => {
          if (!mountedRef.current) return;
          if (bufferSrcRef.current[back] !== wanted.src) return;
          const fromStill = !clipOnScreenRef.current;
          syncPlayback(backVideo, timeSec, playing);
          pauseVideo(frontVideo);
          armClipChange(fromStill);
          frontSlotRef.current = back;
          setFrontSlot(back);
          markClipShowing(wanted);
        };

        if (seekCancelRef.current) {
          // Don't wait forever if the browser never says the seek finished.
          if (performance.now() - seekStartedRef.current > 800) {
            cancelSeek();
            cut();
          }
          return false;
        }

        const drift = Math.abs(backVideo.currentTime - timeSec);
        if (drift < 0.08) {
          cut();
          return true;
        }

        const onSeeked = () => {
          backVideo.removeEventListener("seeked", onSeeked);
          seekCancelRef.current = null;
          cut();
        };
        backVideo.addEventListener("seeked", onSeeked);
        seekCancelRef.current = () =>
          backVideo.removeEventListener("seeked", onSeeked);
        seekStartedRef.current = performance.now();
        // Hold the picture that's up until the new frame is ready.
        pauseVideo(frontVideo);
        try {
          backVideo.currentTime = timeSec;
        } catch {
          cancelSeek();
          cut();
        }
        return false;
      }

      // Neither player has it yet. Download it on the hidden one.
      // Don't freeze the clip that's already up on its last frame.
      showStandby(wanted);
      loadInto(back, wanted.src);
      hideClip(playing, true);
      return false;
    }

    function showPhoto(
      scenes: Scene[],
      positionMs: number,
      bpm: number,
      instant: boolean,
    ) {
      const next = frameAtPosition(scenes, positionMs, bpm);
      const nextId = next?.photo.id ?? null;

      if (nextId !== chosenIdRef.current) {
        if (!next) {
          // This stretch has nothing new. Keep whatever is already up
          // instead of clearing the screen to black.
          chosenIdRef.current = null;
        } else if (!photoIsReady(next.photo.src)) {
          // Not on screen yet. Leave the current picture and try again
          // next frame. Choosing it now would throw it away on the next
          // beat — about a second and a half on a fast song — and the
          // first photo of that line would stay up for the rest of it.
        } else {
          chosenIdRef.current = nextId;
          const token = tokenRef.current + 1;
          tokenRef.current = token;
          const incoming: Slide = {
            photo: next.photo,
            keyword: next.keyword,
            token,
            // Under a clip that's dissolving away, the photo is already
            // fully there. Only the clip fades. A normal photo change
            // still fades in on its own.
            visible: instant,
          };

          if (instant) {
            setSlides((current) => {
              const settled = current.filter((slide) => slide.visible);
              const top = settled[settled.length - 1];
              if (top && top.photo.id === next.photo.id) return [top];
              return [incoming];
            });
            setShownPhotos((current) => rememberPhoto(current, next.photo));
          } else {
            setSlides((current) => {
              // If the newest photo hasn't appeared yet, drop it and keep
              // the last one people actually saw underneath the new fade.
              const settled = current.filter((slide) => slide.visible);
              const base =
                settled.length > 0 ? [settled[settled.length - 1]] : [];
              return [...base, incoming];
            });
          }
        }
      }

      warmPhotos(scenes, positionMs, bpm);
    }

    const tick = () => {
      const currentSong = songRef.current;
      const sample = playbackRef.current;
      // Preview clips don't line up with lyric times. Use one beat-based
      // sequence instead of the lyric scenes. Moving footage stays off —
      // those clips are timed to the real lyric scenes.
      const beatOnly = previewModeRef.current;
      const mode = visualModeRef.current;
      const useClips = mode !== "photos" && !beatOnly;
      let scenes = currentSong?.scenes ?? [];
      if (currentSong && beatOnly) {
        if (beatSong !== currentSong) {
          beatSong = currentSong;
          beatScenes = beatOnlyScenes(currentSong.scenes, currentSong.durationMs);
        }
        scenes = beatScenes;
      }

      // Sentence is still up. Fetch the next photos quietly so the first
      // one can fade in as soon as the sentence leaves. This includes a
      // preview: the black screen lasts until the playhead passes 5 seconds.
      if (holdPhotosRef.current && currentSong) {
        const positionMs = sample ? estimatePositionMs(sample) : 0;
        // The black screen covers this stretch. Stop any clip that was
        // already up, so a rewind into the first 5 seconds goes quiet.
        hideClip(false);
        warmPhotos(currentSong.scenes, positionMs, currentSong.bpm);
        if (useClips) {
          queueNext(currentSong.scenes, positionMs, mode, "");
        }
        frame = requestAnimationFrame(tick);
        return;
      }

      // No playback report yet. Songs with lyrics keep the title card.
      // A preview has no title card — photos follow the beat instead.
      const waitingForPlayback =
        !sample && !beatOnly && currentSong?.lyricsType !== "none";

      if (!currentSong || scenes.length === 0 || waitingForPlayback) {
        if (currentSong && !beatOnly) holdTitle(true);
        if (beatOnly) holdTitle(false);
        if (chosenIdRef.current !== undefined) {
          chosenIdRef.current = undefined;
          setSlides([]);
        }
        if (useClips && currentSong) {
          const positionMs = sample ? estimatePositionMs(sample) : 0;
          queueNext(currentSong.scenes, positionMs, mode, "");
        } else {
          hideClip(false);
        }
      } else {
        const positionMs = sample ? estimatePositionMs(sample) : 0;
        const playing = Boolean(sample?.isPlaying);
        clockScenes = scenes;
        clockPosition = positionMs;
        clockBpm = currentSong.bpm;
        // Rewind into the intro brings the title card back.
        // A preview has no title card — the clock isn't the song's clock.
        if (beatOnly) holdTitle(false);

        // Album cover only, until the first lyric. Photos and clips stay
        // off this stretch, even if one was already on screen. They're
        // still downloaded so the first one is ready when the lyric arrives.
        if (!beatOnly && isTitleCardMoment(currentSong.scenes, positionMs)) {
          holdTitle(true);
          hideClip(playing);
          photosHeld = false;
          if (chosenIdRef.current !== null) {
            chosenIdRef.current = null;
            setSlides([]);
          }
          warmPhotos(scenes, positionMs, currentSong.bpm);
          if (useClips) queueNext(scenes, positionMs, mode, "");
        } else {

        const scene = useClips ? sceneAtPosition(scenes, positionMs) : null;
        const wanted =
          scene && sceneShowsClip(scene, mode) ? (scene.video ?? null) : null;
        const wantedVisible = useClips
          ? updateClipLayer(wanted, scene, positionMs, playing, scenes, mode)
          : false;

        if (!useClips) hideClip(playing, true);

        // Hold the photos while a clip is up, including the moment we're
        // waiting to cut from the clip that's still on screen.
        const covering =
          wantedVisible || (useClips && clipOnScreenRef.current);

        // The clip is up, and we're past the intro. Drop the title card
        // once a dissolve over it has finished. Dropping it immediately
        // would pop the title off while the clip is still see-through.
        if (
          covering &&
          !beatOnly &&
          !isTitleCardMoment(currentSong.scenes, positionMs)
        ) {
          const shownFor = performance.now() - clipShownAtRef.current;
          if (shownFor >= crossfadeMs(currentSong.bpm)) holdTitle(false);
        }

        // Photos keep running until the clip actually covers them, and
        // whenever this scene has no clip.
        if (!covering) {
          // The clip was covering a moment ago. Put the photo for this
          // moment fully on screen, under the clip that's dissolving
          // away. Only the clip fades — the photo does not fade in too.
          let instant = false;
          if (photosHeld) {
            photosHeld = false;
            chosenIdRef.current = undefined;
            instant = true;
          }
          showPhoto(scenes, positionMs, currentSong.bpm, instant);
        } else {
          photosHeld = true;
          // The clip is covering the photos, but the picture for this
          // moment still has to be downloaded. Otherwise the handoff
          // fades the clip onto an empty black screen.
          warmPhotos(scenes, positionMs, currentSong.bpm);
        }
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer);
    };
  }, []);

  function giveUpSlide(token: number, src: string) {
    // The file failed. Drop it if another picture is already up, and
    // don't ask for it again immediately.
    preloadingStarted.delete(src);
    preloadingStarted.delete(quickerUrl(src));
    loadedSrcs.delete(src);
    loadedSrcs.delete(quickerUrl(src));
    retryAfter.set(src, performance.now() + 4000);
    setSlides((current) => {
      const rest = current.filter((slide) => slide.token !== token);
      if (!rest.some((slide) => slide.visible)) return current;
      return rest;
    });
  }

  function revealSlide(token: number, photo: Photo) {
    if (revealedRef.current.has(token)) return;
    if (!slidesRef.current.some((slide) => slide.token === token)) return;
    revealedRef.current.add(token);

    // Wait two frames so the browser paints the photo invisible first.
    // The fade then has a real "from" and "to", instead of popping on.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        if (!slidesRef.current.some((slide) => slide.token === token)) return;

        setSlides((current) =>
          current.map((slide) =>
            slide.token === token ? { ...slide, visible: true } : slide,
          ),
        );
        setShownPhotos((current) => rememberPhoto(current, photo));
      });
    });
  }

  function settleSlide(token: number) {
    // The fade finished. Drop the photo underneath — the new one covers it.
    setSlides((current) => {
      const top = current[current.length - 1];
      if (!top || top.token !== token || !top.visible) return current;
      if (current.length < 2) return current;
      return [top];
    });

    // The photo now covers the title card. Drop the card unless we've
    // rewound into the intro, where it should stay.
    const currentSong = songRef.current;
    const sample = playbackRef.current;
    const inIntro =
      currentSong &&
      sample &&
      isTitleCardMoment(currentSong.scenes, estimatePositionMs(sample));
    if (!inIntro && sample) holdTitle(false);
  }

  if (!song) return null;

  const noLyrics = song.lyricsType === "none";
  const beatOnly = previewMode;
  const hasPhotos = song.scenes.some((scene) => scene.photos.length > 0);
  // No photos: nothing to draw. A centered line explains that.
  if (!hasPhotos) return null;

  const showTitle = titleHeld && !noLyrics && !beatOnly && !holdPhotos;
  // Video and Mix need the players mounted even before the first photo,
  // so the next clip can download during the title card.
  const mayPlayClips =
    visualMode !== "photos" &&
    !beatOnly &&
    song.scenes.some((scene) => sceneShowsClip(scene, visualMode));

  const fadeMs = crossfadeMs(song?.bpm ?? 120);
  // Pexels sends an average color. Show it while the file is still arriving
  // so the screen doesn't flash white.
  const placeholder =
    slides[slides.length - 1]?.photo.avgColor || "var(--color-bg-photo-fallback)";

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden${
        colorMode === "bw" ? " grayscale" : ""
      }`}
      style={{ backgroundColor: holdPhotos ? "var(--color-bg-black)" : placeholder }}
      aria-hidden="true"
    >
      {showTitle && (
        <TitleCard
          song={song}
          playback={playback}
          visualMode={visualMode}
        />
      )}
      {!holdPhotos &&
        slides.map((slide, index) => (
          <FadePhoto
            key={slide.token}
            slide={slide}
            fadeMs={fadeMs}
            // Above the title card, so the first photo can fade in over it.
            zIndex={index + 1}
            onReveal={revealSlide}
            onSettled={settleSlide}
            onGiveUp={giveUpSlide}
          />
        ))}
      {/* Still frame while a clip downloads and no photo is visible yet. */}
      {mayPlayClips &&
        !clipOnScreen &&
        !showTitle &&
        !slides.some((slide) => slide.visible) &&
        standbyClip?.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={standbyClip.poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ zIndex: 0 }}
          />
        )}
      {mayPlayClips && (
        <>
          <ClipSurface
            videoRef={videoRefA}
            visible={clipOnScreen && frontSlot === 0}
            fade={clipFade}
            fadeMs={fadeMs}
          />
          <ClipSurface
            videoRef={videoRefB}
            visible={clipOnScreen && frontSlot === 1}
            fade={clipFade}
            fadeMs={fadeMs}
          />
        </>
      )}
    </div>
  );
}

/**
 * One of the two full-screen clip players.
 * The file address is set from the animation loop, not here, so React
 * doesn't reload it on every frame. Muted, so the song stays the only sound.
 * No playback controls — pause and skip come from the song position.
 *
 * Opacity is set here, not from the animation loop. A loop that set it
 * every frame would cancel the dissolve. `fade` is off for a single
 * paint when one clip replaces another, so that change cuts.
 */
function ClipSurface({
  videoRef,
  visible,
  fade,
  fadeMs,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  visible: boolean;
  fade: boolean;
  fadeMs: number;
}) {
  // Stay on screen through a dissolve. Once the clip is fully gone,
  // park it off to the side. A hidden video left full-screen paints a
  // black layer in some browsers and covers the photos.
  const [painted, setPainted] = useState(visible);
  const [tracked, setTracked] = useState({ visible, fade });

  if (tracked.visible !== visible || tracked.fade !== fade) {
    setTracked({ visible, fade });
    if (visible) setPainted(true);
    else if (!fade) setPainted(false);
  }

  const onScreen = visible || painted;

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
      onTransitionEnd={(event) => {
        if (event.propertyName !== "opacity") return;
        if (!visible) setPainted(false);
      }}
      style={{
        zIndex: 40,
        opacity: visible ? 1 : 0,
        transform: onScreen ? undefined : "translate3d(-120vw, 0, 0)",
        transition: fade ? `opacity ${fadeMs}ms ease-in-out` : "none",
      }}
    />
  );
}

/**
 * Album cover and a countdown to the first photo or clip.
 * Shown through the opening, and until that first picture has faded in.
 * The countdown waits until Spotify is playing the full song. A preview
 * does not start at the beginning, so that clock would be wrong.
 */
function TitleCard({
  song,
  playback,
  visualMode,
}: {
  song: SongPackage;
  playback: PlaybackSample | null;
  visualMode: VisualMode;
}) {
  const startsAtMs = firstVisualStartMs(song.scenes, visualMode);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const showCountdown =
    classifyPlayback(song.durationMs, playback?.reportedDurationMs) === "full";

  const [secondsLeft, setSecondsLeft] = useState(() =>
    secondsUntilShow(startsAtMs, playback),
  );

  // Spotify reports position about once a second. Between reports, follow
  // the song clock so the countdown keeps moving while the music plays
  // and holds still while it is paused.
  useEffect(() => {
    let frame = 0;
    let shown = secondsUntilShow(startsAtMs, playbackRef.current);
    setSecondsLeft(shown);

    const tick = () => {
      const next = secondsUntilShow(startsAtMs, playbackRef.current);
      if (next !== shown) {
        shown = next;
        setSecondsLeft(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startsAtMs]);

  return (
    <div className="absolute inset-0" style={{ zIndex: 0 }}>
      {song.albumCoverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={song.albumCoverUrl}
          alt=""
          className="title-card-zoom absolute inset-0 h-full w-full object-cover"
          style={{ filter: "blur(28px)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-bg-black)]" />
      )}
      <div className="absolute inset-0 bg-[var(--color-bg-black)]/45" />
      {showCountdown && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <p className="screen-status tabular-nums">
            Visuals start in {formatCountdown(secondsLeft)}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * When the first photo or clip is scheduled to appear.
 * Scenes with nothing to show are skipped, so the countdown lands on
 * the first picture people will actually see.
 */
function firstVisualStartMs(scenes: Scene[], mode: VisualMode): number {
  for (const scene of scenes) {
    if (scene.titleCard) continue;
    if (sceneShowsClip(scene, mode) || scene.photos.length > 0) {
      return scene.startMs;
    }
  }

  const card = scenes.find((scene) => scene.titleCard);
  return card?.endMs ?? 0;
}

/** Whole seconds left until the first picture, counting the current second. */
function secondsUntilShow(
  startsAtMs: number,
  playback: PlaybackSample | null,
): number {
  const remaining = startsAtMs - estimatePositionMs(playback);
  if (!(remaining > 0)) return 0;
  return Math.ceil(remaining / 1000);
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * One full-screen photo.
 * It stays invisible until a file has loaded, then fades in.
 * A smaller copy fades in first when the full file is still on the way,
 * so the crossfade has pixels instead of the empty background.
 * A plain image tag (not Next's image helper) because we fade it ourselves
 * and preload the upcoming ones. The helper would delay that.
 */
function FadePhoto({
  slide,
  fadeMs,
  zIndex,
  onReveal,
  onSettled,
  onGiveUp,
}: {
  slide: Slide;
  fadeMs: number;
  zIndex: number;
  onReveal: (token: number, photo: Photo) => void;
  onSettled: (token: number) => void;
  onGiveUp: (token: number, src: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const previewRef = useRef<HTMLImageElement>(null);
  const onRevealRef = useRef(onReveal);
  const triesRef = useRef(0);
  const quickSrc = quickerUrl(slide.photo.src);
  const [sharpReady, setSharpReady] = useState(() =>
    loadedSrcs.has(slide.photo.src),
  );

  useEffect(() => {
    onRevealRef.current = onReveal;
  });

  // Cached photos can finish loading before React attaches onLoad.
  // If the file is already here, start the fade from this effect too.
  useEffect(() => {
    triesRef.current = 0;
    const img = imgRef.current;
    const ready =
      loadedSrcs.has(slide.photo.src) ||
      Boolean(img && img.complete && img.naturalWidth > 0);
    if (!ready) return;
    loadedSrcs.add(slide.photo.src);
    setSharpReady(true);
    onRevealRef.current(slide.token, slide.photo);
  }, [slide.token, slide.photo]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    if (preview.complete && preview.naturalWidth > 0) {
      loadedSrcs.add(quickSrc);
      onRevealRef.current(slide.token, slide.photo);
    }
  }, [slide.token, slide.photo, quickSrc]);

  const fade = `${fadeMs}ms`;

  return (
    <div
      className="absolute inset-0"
      style={{ zIndex, backgroundColor: slide.photo.avgColor }}
    >
      {quickSrc !== slide.photo.src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={previewRef}
          src={quickSrc}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: slide.visible ? 1 : 0,
            transitionProperty: "opacity",
            transitionDuration: fade,
            transitionTimingFunction: "ease-in-out",
          }}
          onLoad={() => {
            loadedSrcs.add(quickSrc);
            onReveal(slide.token, slide.photo);
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "opacity") return;
            if (event.target !== event.currentTarget) return;
            if (!slide.visible) return;
            onSettled(slide.token);
          }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={slide.photo.src}
        alt=""
        data-photo-id={slide.photo.id}
        data-keyword={slide.keyword}
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: slide.visible && sharpReady ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: fade,
          transitionTimingFunction: "ease-in-out",
        }}
        onLoad={() => {
          loadedSrcs.add(slide.photo.src);
          setSharpReady(true);
          onReveal(slide.token, slide.photo);
        }}
        onError={() => {
          const img = imgRef.current;
          if (img && triesRef.current < 1) {
            triesRef.current += 1;
            const src = slide.photo.src;
            img.src = "";
            img.src = src;
            return;
          }
          // The smaller copy is already up. Keep that instead of going empty.
          if ((previewRef.current?.naturalWidth ?? 0) > 0) return;
          onGiveUp(slide.token, slide.photo.src);
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName !== "opacity") return;
          if (event.target !== event.currentTarget) return;
          if (!slide.visible || !sharpReady) return;
          onSettled(slide.token);
        }}
      />
    </div>
  );
}

/** Add a photo to the "actually shown" list the first time it appears. */
function rememberPhoto(shown: Photo[], photo: Photo): Photo[] {
  if (shown.some((item) => item.id === photo.id)) return shown;
  return [...shown, photo];
}

/** Same for a clip. A clip that only preloaded is not in this list. */
function rememberClip(shown: VideoClip[], clip: VideoClip): VideoClip[] {
  if (shown.some((item) => item.id === clip.id)) return shown;
  return [...shown, clip];
}

/** Start downloading each address once. Later fades can use the cache. */
function preloadAhead(srcs: string[], already: Set<string>) {
  const now = performance.now();

  for (const src of srcs) {
    if (!src || already.has(src) || loadedSrcs.has(src)) continue;
    const wait = retryAfter.get(src) ?? 0;
    if (wait > now) continue;
    // Already downloading. Keep that Image alive — if nothing holds it,
    // the browser cancels the request and the photo starts over when
    // it's time to show, which is the blank flash.
    if (preloading.has(src)) {
      already.add(src);
      continue;
    }

    already.add(src);
    const img = new Image();
    preloading.set(src, img);
    img.decoding = "async";
    img.fetchPriority = "low";

    const drop = () => {
      if (preloading.get(src) === img) preloading.delete(src);
    };

    img.onload = () => {
      const finish = () => {
        loadedSrcs.add(src);
        retryAfter.delete(src);
        drop();
      };
      if (typeof img.decode === "function") {
        img.decode().then(finish, finish);
      } else {
        finish();
      }
    };

    img.onerror = () => {
      already.delete(src);
      drop();
      retryAfter.set(src, performance.now() + 4000);
    };

    img.src = src;
  }
}

/**
 * Download the photo for this moment and the next few, plus a smaller
 * copy of the nearest ones. The small copy is what fades in if the full
 * file is still coming.
 */
function warmPhotos(scenes: Scene[], positionMs: number, bpm: number) {
  const current = frameAtPosition(scenes, positionMs, bpm);
  const ahead = upcomingPhotoSrcs(scenes, positionMs, bpm, 3);
  const full = current ? [current.photo.src, ...ahead] : ahead;
  const quick = full
    .slice(0, 2)
    .map((src) => quickerUrl(src))
    .filter((src, index) => src !== full[index]);
  preloadAhead([...quick, ...full], preloadingStarted);
}

/**
 * A narrower copy of a Pexels photo. large2x is about 1880 pixels wide
 * and is often still downloading when the beat says to change pictures.
 * Around 1280 pixels wide is enough to fill the screen while that arrives.
 */
function quickerUrl(src: string): string {
  try {
    const url = new URL(src);
    const width = Number(url.searchParams.get("w"));
    const dpr = Number(url.searchParams.get("dpr") || "1");
    const pixels =
      (Number.isFinite(width) && width > 0 ? width : 1880) *
      (Number.isFinite(dpr) && dpr > 0 ? dpr : 1);
    if (pixels <= 1280) return src;

    url.searchParams.set("auto", "compress");
    url.searchParams.set("cs", "tinysrgb");
    url.searchParams.set("w", "1280");
    url.searchParams.delete("dpr");
    url.searchParams.delete("h");
    return url.toString();
  } catch {
    return src;
  }
}

/** True when the full photo or its smaller copy has finished decoding. */
function photoIsReady(src: string): boolean {
  if (loadedSrcs.has(src)) return true;
  const quick = quickerUrl(src);
  return quick !== src && loadedSrcs.has(quick);
}

/** True when this moment of the file is already downloaded. */
function mediaCovers(video: HTMLVideoElement, timeSec: number): boolean {
  if (video.readyState < 2) return false;
  try {
    const buffered = video.buffered;
    for (let i = 0; i < buffered.length; i += 1) {
      if (
        timeSec >= buffered.start(i) - 0.05 &&
        timeSec <= buffered.end(i) + 0.02
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

// How far a playing clip can drift before we seek. Smaller jumps are
// the normal once-a-second twitch from Spotify, and seeking on those
// blanks the frame.
const PLAYING_SEEK_SEC = 1.25;

// Photos that have finished decoding. Kept for the whole tab so a new
// song doesn't throw away pictures the browser already has.
const loadedSrcs = new Set<string>();
// Image objects we must keep until the download finishes.
const preloading = new Map<string, HTMLImageElement>();
// Addresses we've already asked the browser to download.
const preloadingStarted = new Set<string>();
// Don't hammer a URL that just failed.
const retryAfter = new Map<string, number>();
