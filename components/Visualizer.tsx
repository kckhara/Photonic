"use client";

import { useEffect, useRef, useState } from "react";
import { isTitleCardMoment } from "@/lib/scenes";
import {
  crossfadeMs,
  estimatePositionMs,
  frameAtPosition,
  upcomingPhotoSrcs,
} from "@/lib/tempo";
import type { Photo, PlaybackSample, SongPackage } from "@/lib/types";

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
 * Before the first lyric, and while the first photo is still downloading,
 * a title card shows the album cover with the song title and artist.
 * The first photo fades in on top of that card.
 *
 * A song with no lyrics skips the title card. The page shows a short
 * sentence first (holdPhotos). This component keeps the screen dark and
 * downloads the upcoming photos, then starts them on the beat.
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
  onShownPhotos,
}: {
  song: SongPackage | null;
  playback: PlaybackSample | null;
  // True while the no-lyrics sentence is on screen. Photos wait.
  holdPhotos?: boolean;
  // Called with every photo that has actually appeared. Later, the
  // credits screen lists the photographers from this list.
  onShownPhotos?: (photos: Photo[]) => void;
}) {
  const songRef = useRef(song);
  const playbackRef = useRef(playback);
  const onShownRef = useRef(onShownPhotos);
  const holdPhotosRef = useRef(holdPhotos);

  const [slides, setSlides] = useState<Slide[]>([]);
  const [shownPhotos, setShownPhotos] = useState<Photo[]>([]);
  // Stays up through the intro and until the first photo has finished fading in.
  const [titleHeld, setTitleHeld] = useState(true);
  const slidesRef = useRef(slides);
  const titleHeldRef = useRef(true);

  // The animation loop reads these between renders. Update them after
  // each render so the loop sees the latest song and playback position.
  useEffect(() => {
    songRef.current = song;
    playbackRef.current = playback;
    onShownRef.current = onShownPhotos;
    slidesRef.current = slides;
    holdPhotosRef.current = holdPhotos;
  });

  // Which photo the loop last chose. Undefined until the first choice,
  // so "nothing yet" is different from "no photo at this moment".
  const chosenIdRef = useRef<number | null | undefined>(undefined);
  const tokenRef = useRef(0);
  const preloadedRef = useRef<Set<string>>(new Set());
  const revealedRef = useRef<Set<number>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onShownRef.current?.(shownPhotos);
  }, [shownPhotos]);

  // Runs every frame. Picks the photo for the current position and,
  // if it changed, starts a fade. Also asks the browser to download
  // the next 3 photos before we need them.
  useEffect(() => {
    let frame = 0;

    const tick = () => {
      const currentSong = songRef.current;
      const sample = playbackRef.current;

      // Sentence is still up. Fetch the next photos quietly so the first
      // one can fade in as soon as the sentence leaves.
      if (holdPhotosRef.current && currentSong) {
        const positionMs = sample ? estimatePositionMs(sample) : 0;
        preloadAhead(
          upcomingPhotoSrcs(
            currentSong.scenes,
            positionMs,
            currentSong.bpm,
            3,
          ),
          preloadedRef.current,
        );
        frame = requestAnimationFrame(tick);
        return;
      }

      // No playback report yet. Songs with lyrics keep the title card.
      // A song with no lyrics can still show the photo for 0:00, so the
      // screen isn't blank after the sentence if Spotify is slow to start.
      const waitingForPlayback =
        !sample && currentSong?.lyricsType !== "none";

      if (
        !currentSong ||
        currentSong.scenes.length === 0 ||
        waitingForPlayback
      ) {
        if (currentSong) holdTitle(true);
        if (chosenIdRef.current !== undefined) {
          chosenIdRef.current = undefined;
          setSlides([]);
        }
      } else {
        const positionMs = sample ? estimatePositionMs(sample) : 0;
        // Rewind into the intro brings the title card back.
        if (isTitleCardMoment(currentSong.scenes, positionMs)) holdTitle(true);
        const next = frameAtPosition(
          currentSong.scenes,
          positionMs,
          currentSong.bpm,
        );
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
              visible: false,
            };

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

        preloadAhead(
          upcomingPhotoSrcs(currentSong.scenes, positionMs, currentSong.bpm, 3),
          preloadedRef.current,
        );
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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

  function holdTitle(next: boolean) {
    if (titleHeldRef.current === next) return;
    titleHeldRef.current = next;
    setTitleHeld(next);
  }

  if (!song) return null;

  const noLyrics = song.lyricsType === "none";
  const hasPhotos = song.scenes.some((scene) => scene.photos.length > 0);
  // No lyrics and no photos: nothing to draw. The player explains it.
  if (noLyrics && !hasPhotos) return null;

  const showTitle = titleHeld && !noLyrics && !holdPhotos;
  // Keep the dark screen up for a no-lyrics song until the first photo
  // is chosen, so the page doesn't flash empty between the sentence and the pictures.
  if (!noLyrics && !showTitle && slides.length === 0) return null;

  const fadeMs = crossfadeMs(song?.bpm ?? 120);
  // Pexels sends an average color. Show it while the file is still arriving
  // so the screen doesn't flash white.
  const placeholder =
    slides[slides.length - 1]?.photo.avgColor || "#111111";

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
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
    </div>
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
