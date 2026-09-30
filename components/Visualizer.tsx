"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
 *
 * Before the first lyric, a title card shows the album cover with the
 * song title and artist. Pictures and clips wait until that lyric.
 * The card also stays up while the first photo is still downloading.
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
  const preloadedRef = useRef<Set<string>>(new Set());
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
    function loadInto(slot: 0 | 1, src: string) {
      if (!src || bufferSrcRef.current[slot] === src) return;
      const video = videoAt(slot);
      if (!video) return;
      cancelSeek();
      bufferSrcRef.current[slot] = src;
      video.muted = true;
      video.defaultMuted = true;
      video.preload = "auto";
      video.src = src;
      video.load();
    }

    function showStandby(clip: VideoClip | null) {
      const nextId = clip?.id ?? null;
      if (standbyIdRef.current === nextId) return;
      standbyIdRef.current = nextId;
      setStandbyClip(clip);
    }

    // Leave the clip. If one is actually up, dissolve it away over one
    // beat and keep it playing until that finishes. Calling this again
    // on the next frame must not restart that dissolve.
    function hideClip(playing: boolean) {
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
    // correct a real drift — seeking every frame would stutter.
    // While paused or after a skip, snap to the exact frame.
    function syncPlayback(
      video: HTMLVideoElement,
      timeSec: number,
      playing: boolean,
    ) {
      video.muted = true;
      const drift = Math.abs(video.currentTime - timeSec);
      const snap = !playing || drift > 0.4;
      if (snap && drift > 0.05 && video.readyState >= 1) {
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
      if (!wanted || !scene) {
        hideClip(playing);
        queueNext(scenes, positionMs, mode, "");
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
      if (frontVideo && bufferSrcRef.current[front] === wanted.src) {
        if (frontVideo.readyState < 2) {
          showStandby(wanted);
          return false;
        }
        cancelSeek();
        syncPlayback(frontVideo, timeSec, playing);
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

      // Neither player has it yet. Download it on the hidden one and
      // keep whatever is already on screen (a photo, or the last clip).
      showStandby(wanted);
      loadInto(back, wanted.src);
      if (
        frontVideo &&
        bufferSrcRef.current[front] &&
        bufferSrcRef.current[front] !== wanted.src
      ) {
        pauseVideo(frontVideo);
      }
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
        chosenIdRef.current = nextId;

        if (!next) {
          setSlides([]);
        } else {
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

      preloadAhead(
        upcomingPhotoSrcs(scenes, positionMs, bpm, 3),
        preloadedRef.current,
      );
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
        preloadAhead(
          upcomingPhotoSrcs(
            currentSong.scenes,
            positionMs,
            currentSong.bpm,
            3,
          ),
          preloadedRef.current,
        );
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
          preloadAhead(
            upcomingPhotoSrcs(scenes, positionMs, currentSong.bpm, 3),
            preloadedRef.current,
          );
          if (useClips) queueNext(scenes, positionMs, mode, "");
        } else {

        const scene = useClips ? sceneAtPosition(scenes, positionMs) : null;
        const wanted =
          scene && sceneShowsClip(scene, mode) ? (scene.video ?? null) : null;
        const wantedVisible = useClips
          ? updateClipLayer(wanted, scene, positionMs, playing, scenes, mode)
          : false;

        if (!useClips) hideClip(playing);

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
  // No lyrics and no photos: nothing to draw. The player explains it.
  if (!hasPhotos && (noLyrics || beatOnly)) return null;

  const showTitle = titleHeld && !noLyrics && !beatOnly && !holdPhotos;
  // Video and Mix need the players mounted even before the first photo,
  // so the next clip can download during the title card.
  const mayPlayClips =
    visualMode !== "photos" &&
    !beatOnly &&
    song.scenes.some((scene) => sceneShowsClip(scene, visualMode));
  // Keep the dark screen up for a no-lyrics song until the first photo
  // is chosen, so the page doesn't flash empty between the sentence and the pictures.
  // A preview keeps the screen up too, so photos can start on the beat.
  if (
    !noLyrics &&
    !beatOnly &&
    !showTitle &&
    slides.length === 0 &&
    !mayPlayClips
  ) {
    return null;
  }

  const fadeMs = crossfadeMs(song?.bpm ?? 120);
  // Pexels sends an average color. Show it while the file is still arriving
  // so the screen doesn't flash white.
  const placeholder =
    slides[slides.length - 1]?.photo.avgColor || "#111111";

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden${
        colorMode === "bw" ? " grayscale" : ""
      }`}
      style={{ backgroundColor: holdPhotos ? "#000000" : placeholder }}
      aria-hidden="true"
    >
      {showTitle && <TitleCard song={song} />}
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
          />
        ))}
      {/* Still frame while the first clip downloads and there's no photo yet. */}
      {mayPlayClips &&
        !clipOnScreen &&
        !showTitle &&
        slides.length === 0 &&
        standbyClip?.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={standbyClip.poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ zIndex: 30 }}
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
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        zIndex: 40,
        opacity: visible ? 1 : 0,
        transition: fade ? `opacity ${fadeMs}ms ease-in-out` : "none",
      }}
    />
  );
}

/**
 * Album cover, song title, and artist.
 * Shown before the first lyric, and until the first photo has faded in.
 * Simple on purpose — the real design comes in Phase 10.
 */
function TitleCard({ song }: { song: SongPackage }) {
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
        <div className="absolute inset-0 bg-black" />
      )}
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-white">
        <p className="text-4xl font-semibold tracking-tight">{song.title}</p>
        <p className="mt-3 text-xl">{song.artist}</p>
      </div>
    </div>
  );
}

/**
 * One full-screen photo.
 * It stays invisible until the file has loaded, then fades in.
 * A plain image tag (not Next's image helper) because we fade it ourselves
 * and preload the upcoming ones. The helper would delay that.
 */
function FadePhoto({
  slide,
  fadeMs,
  zIndex,
  onReveal,
  onSettled,
}: {
  slide: Slide;
  fadeMs: number;
  zIndex: number;
  onReveal: (token: number, photo: Photo) => void;
  onSettled: (token: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const onRevealRef = useRef(onReveal);

  useEffect(() => {
    onRevealRef.current = onReveal;
  });

  // Cached photos can finish loading before React attaches onLoad.
  // If the file is already here, start the fade from this effect too.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      onRevealRef.current(slide.token, slide.photo);
    }
  }, [slide.token, slide.photo]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={slide.photo.src}
      alt=""
      data-photo-id={slide.photo.id}
      data-keyword={slide.keyword}
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        zIndex,
        opacity: slide.visible ? 1 : 0,
        transitionProperty: "opacity",
        transitionDuration: `${fadeMs}ms`,
        transitionTimingFunction: "ease-in-out",
        backgroundColor: slide.photo.avgColor,
      }}
      onLoad={() => onReveal(slide.token, slide.photo)}
      onTransitionEnd={(event) => {
        if (event.propertyName !== "opacity") return;
        if (event.target !== event.currentTarget) return;
        if (!slide.visible) return;
        onSettled(slide.token);
      }}
    />
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
  for (const src of srcs) {
    if (already.has(src)) continue;
    already.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}
