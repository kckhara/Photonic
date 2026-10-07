"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AboutButton } from "@/components/AboutButton";
import { Credits } from "@/components/Credits";
import { NoLyricsMessage, NO_LYRICS_INTRO_MS } from "@/components/NoLyricsMessage";
import { PlayerBar, type PlayerCommand } from "@/components/PlayerBar";
import { SearchBox } from "@/components/SearchBox";
import { Visualizer } from "@/components/Visualizer";
import type { SearchHit } from "@/lib/deezer";
import {
  PREVIEW_MAX_MS,
  classifyPlayback,
  playbackHasEnded,
  type PlaybackKind,
} from "@/lib/preview";
import { estimatePositionMs } from "@/lib/tempo";
import type {
  ColorMode,
  Photo,
  PlaybackSample,
  SongPackage,
  VideoClip,
  VisualMode,
} from "@/lib/types";

/**
 * Homepage. A first visit shows the search bar, the About button, and a
 * centered introduction. After a song is chosen, search stays where it
 * is until the Spotify player appears. The player then moves in at the
 * top, and search and the media filters move down with it. Photos fill
 * the screen. If nothing moves for a few seconds, search and the filters
 * slide up behind the player and fade. The player stays where it is.
 * Any movement brings search and the filters back.
 * This file runs in the browser because it has to remember the chosen song.
 *
 * If Spotify is only playing a 30-second preview, a line under the
 * player offers a login link. Photos keep playing behind it.
 *
 * When a full song finishes, a credits screen covers the pictures.
 * Search stays at the top so another song can be chosen. A preview
 * never uses that screen.
 */

// How long the page stays still before the search and filters hide.
const IDLE_MS = 3000;

export default function Home() {
  // pickId changes on every choice, even the same row twice, so the player
  // starts that request from scratch instead of keeping the previous song.
  const nextPickId = useRef(0);
  // Photos that really appeared on screen. The credits screen reads this
  // when the song ends, so preloaded-but-unseen photos stay off the list.
  const shownPhotosRef = useRef<Photo[]>([]);
  const shownVideosRef = useRef<VideoClip[]>([]);
  // True once they pick Photos / Video / Mix, or Black & white / Color,
  // so the saved choice doesn't overwrite that click.
  const modeTouchedRef = useRef(false);
  const colorTouchedRef = useRef(false);
  // True while the credits screen is up, so a second "ended" report
  // doesn't open it again.
  const creditsOpenRef = useRef(false);
  const reportedDurationRef = useRef<number | null>(null);
  // True once the playhead has been in the last second. The next reading
  // can then notice a jump back to the start.
  const nearEndRef = useRef(false);
  // Skip end detection for the sample that "Play again" or "Reload" just caused.
  const ignoreEndRef = useRef(false);
  const acceptPlaybackAfterRef = useRef(0);
  const songRef = useRef<SongPackage | null>(null);
  const playbackRef = useRef<PlaybackSample | null>(null);
  const previewModeRef = useRef(false);
  const heardPlaybackRef = useRef(false);
  const lastVerdictRef = useRef<PlaybackKind>("unknown");

  const [pick, setPick] = useState<{
    hit: SearchHit;
    pickId: number;
  } | null>(null);
  const [song, setSong] = useState<SongPackage | null>(null);
  const [playback, setPlayback] = useState<PlaybackSample | null>(null);
  // True while the no-lyrics sentence is up, or while we wait to learn
  // whether a lyric-less song is only a preview. Photos wait either way.
  const [holdPhotos, setHoldPhotos] = useState(false);
  const [showNoLyricsSentence, setShowNoLyricsSentence] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  // Phones include landscape, which is wider than the layout breakpoint.
  // Spotify on a phone often reports the full song length while only
  // playing the 30-second preview. Until that preview is over, photos
  // stay on the beat: no album cover, no clips.
  const [phoneLayout, setPhoneLayout] = useState<boolean | null>(null);
  // True once a phone has been playing for longer than a preview.
  // Spotify's position is not used here: one high reading would
  // drop the photos and bring the flashing cover back.
  const [passedPreview, setPassedPreview] = useState(false);
  const passedPreviewRef = useRef(false);
  const playedMsRef = useRef(0);
  const playStampRef = useRef<number | null>(null);
  const [playerCommand, setPlayerCommand] = useState<PlayerCommand | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  // Copied when the song ends, then updated if the last photo finishes
  // fading in a moment later.
  const [creditPhotos, setCreditPhotos] = useState<Photo[]>([]);
  const [creditVideos, setCreditVideos] = useState<VideoClip[]>([]);
  // Photos & Videos, and black and white, until we can read what they chose
  // earlier in this visit.
  const [visualMode, setVisualMode] = useState<VisualMode>("mix");
  const [colorMode, setColorMode] = useState<ColorMode>("bw");
  const [searchOpen, setSearchOpen] = useState(false);
  const [controlsIdle, setControlsIdle] = useState(false);
  const controlsIdleRef = useRef(false);
  controlsIdleRef.current = controlsIdle;
  // Stays open after the first embed so a later song doesn't snap search
  // back up while the next player loads.
  const [playerIn, setPlayerIn] = useState(false);
  const onPlayerVisible = useCallback((visible: boolean) => {
    if (visible) setPlayerIn(true);
  }, []);

  useEffect(() => {
    songRef.current = song;
    previewModeRef.current = previewMode;
    playbackRef.current = playback;
  });

  // No lyrics: black screen and the sentence while the playhead is still
  // in the first 5 seconds. Pause holds it. Skip and rewind follow the song.
  // A 30-second preview uses the same clock, so the sentence is there too.
  useEffect(() => {
    if (!needsNoLyricsMessage(song)) return;

    let frame = 0;
    let intro: boolean | null = null;

    const tick = () => {
      const position = estimatePositionMs(playbackRef.current);
      const next = position < NO_LYRICS_INTRO_MS;
      if (next !== intro) {
        intro = next;
        setShowNoLyricsSentence(next);
        setHoldPhotos(next);
      }
      frame = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(frame);
  }, [song]);

  // The Photos / Video / Mix choice, and black and white or color,
  // last until this tab is closed.
  useEffect(() => {
    if (modeTouchedRef.current) return;
    setVisualMode(readVisualMode());
  }, []);

  useEffect(() => {
    if (colorTouchedRef.current) return;
    setColorMode(readColorMode());
  }, []);

  useEffect(() => {
    const query = window.matchMedia(
      "(max-width: 760px), ((hover: none) and (pointer: coarse))",
    );
    const sync = () => setPhoneLayout(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Hide the search and filters after a still moment, then bring them
  // back when the pointer, keyboard, or wheel moves. Wait until the
  // player has moved in, so search doesn't slide away while it loads.
  useEffect(() => {
    if (!pick || !playerIn || searchOpen || showCredits) return;

    let idle = false;
    let suppressUntil = 0;
    let timer = 0;

    function goIdle() {
      idle = true;
      // Ignore pointer events the fading controls can fire on their own.
      suppressUntil = performance.now() + 403;
      setControlsIdle(true);
    }

    function wake(event: Event) {
      if (performance.now() < suppressUntil) return;
      if (
        event.type === "pointermove" &&
        event instanceof PointerEvent &&
        event.movementX === 0 &&
        event.movementY === 0
      ) {
        return;
      }
      window.clearTimeout(timer);
      if (idle || controlsIdleRef.current) {
        idle = false;
        setControlsIdle(false);
      }
      timer = window.setTimeout(goIdle, IDLE_MS);
    }

    timer = window.setTimeout(goIdle, IDLE_MS);
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const name of events) {
      window.addEventListener(name, wake, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, [pick, playerIn, searchOpen, showCredits]);

  function enterPreview() {
    previewModeRef.current = true;
    setPreviewMode(true);
  }

  function enterFullSong() {
    previewModeRef.current = false;
    setPreviewMode(false);
  }

  // Shared "did playback just finish?" check. Returns null when this
  // reading should be ignored (a Play again / Reload we just started,
  // or Spotify hasn't told us the length yet).
  function endingOf(sample: PlaybackSample) {
    if (ignoreEndRef.current) {
      if (sample.receivedAt < acceptPlaybackAfterRef.current) return null;
      if (!sample.isPlaying) return null;
      ignoreEndRef.current = false;
      return null;
    }

    const duration = sample.reportedDurationMs ?? reportedDurationRef.current;
    if (!duration) return null;

    return playbackHasEnded(
      sample.positionMs,
      duration,
      sample.isPaused,
      nearEndRef.current,
    );
  }

  function considerPreviewEnd(sample: PlaybackSample) {
    const result = endingOf(sample);
    if (!result) return;

    if (result.ended) {
      nearEndRef.current = false;
      return;
    }

    nearEndRef.current = result.nearEnd;
  }

  function considerSongEnd(sample: PlaybackSample) {
    const result = endingOf(sample);
    if (!result) return;

    if (result.ended) {
      nearEndRef.current = false;
      openCredits();
      return;
    }

    nearEndRef.current = result.nearEnd;
  }

  function openCredits() {
    // A preview does not open the credits screen.
    if (creditsOpenRef.current || previewModeRef.current || !songRef.current) {
      return;
    }
    creditsOpenRef.current = true;
    setCreditPhotos(shownPhotosRef.current);
    setCreditVideos(shownVideosRef.current);
    setControlsIdle(false);
    setShowCredits(true);
  }

  function closeCredits() {
    creditsOpenRef.current = false;
    setShowCredits(false);
    setCreditPhotos([]);
    setCreditVideos([]);
  }

  function applyVerdict(verdict: PlaybackKind) {
    if (verdict === "unknown") return;
    // A preview embed sometimes reports the full song length on the
    // next update. Leaving preview then puts the album cover back and
    // clears the photo that just appeared. Stay in preview until the
    // playhead has actually passed the clip.
    if (
      verdict === "full" &&
      lastVerdictRef.current === "preview" &&
      !passedPreviewRef.current
    ) {
      return;
    }
    if (verdict === lastVerdictRef.current) return;
    lastVerdictRef.current = verdict;
    if (verdict === "preview") enterPreview();
    else enterFullSong();
  }

  function resetPreviewState() {
    heardPlaybackRef.current = false;
    previewModeRef.current = false;
    lastVerdictRef.current = "unknown";
    reportedDurationRef.current = null;
    nearEndRef.current = false;
    ignoreEndRef.current = false;
    acceptPlaybackAfterRef.current = 0;
    passedPreviewRef.current = false;
    playedMsRef.current = 0;
    playStampRef.current = null;
    setPassedPreview(false);
    setPreviewMode(false);
    setPlayerCommand(null);
  }

  function onSelect(hit: SearchHit) {
    nextPickId.current += 1;
    songRef.current = null;
    setHoldPhotos(false);
    setShowNoLyricsSentence(false);
    closeCredits();
    setPick({ hit, pickId: nextPickId.current });
    setSong(null);
    setPlayback(null);
    resetPreviewState();
    shownPhotosRef.current = [];
    shownVideosRef.current = [];
    setControlsIdle(false);
  }

  function onVisualMode(mode: VisualMode) {
    modeTouchedRef.current = true;
    setVisualMode(mode);
    rememberVisualMode(mode);
  }

  function onColorMode(mode: ColorMode) {
    colorTouchedRef.current = true;
    setColorMode(mode);
    rememberColorMode(mode);
  }

  function onSong(next: SongPackage | null) {
    songRef.current = next;
    setSong(next);

    // The sentence is for a song with no lyrics, while it is still early.
    // The playhead decides when it leaves, including on a preview.
    if (!needsNoLyricsMessage(next)) {
      setShowNoLyricsSentence(false);
      setHoldPhotos(false);
      return;
    }

    setHoldPhotos(true);
    setShowNoLyricsSentence(true);
  }

  function onPlayback(sample: PlaybackSample | null) {
    setPlayback(sample);

    if (sample?.reportedDurationMs && sample.reportedDurationMs > 0) {
      reportedDurationRef.current = sample.reportedDurationMs;
    }
    if (!sample) {
      playStampRef.current = null;
      return;
    }

    const reported = reportedDurationRef.current;
    if (sample.isPlaying) {
      const stamp = playStampRef.current;
      if (stamp != null) {
        const delta = sample.receivedAt - stamp;
        if (delta > 0 && delta < 2000) playedMsRef.current += delta;
      }
      playStampRef.current = sample.receivedAt;
    } else {
      playStampRef.current = null;
    }
    if (
      !passedPreviewRef.current &&
      reported &&
      reported > PREVIEW_MAX_MS &&
      playedMsRef.current > PREVIEW_MAX_MS
    ) {
      passedPreviewRef.current = true;
      setPassedPreview(true);
    }

    if (sample.isPlaying) heardPlaybackRef.current = true;

    const currentSong = songRef.current;
    if (!currentSong) return;

    // A length is enough to know this is a preview. Waiting until the
    // play button works would leave the album cover up for the whole clip.
    if (reported) {
      applyVerdict(classifyPlayback(currentSong.durationMs, reported));
    }

    if (!heardPlaybackRef.current) return;

    // A preview does not open credits. A full song does.
    // "Unknown" means Spotify hasn't reported a length yet, so we wait.
    if (lastVerdictRef.current === "preview") considerPreviewEnd(sample);
    else if (lastVerdictRef.current === "full") considerSongEnd(sample);
  }

  function onSearchOpenChange(open: boolean) {
    if (open) setControlsIdle(false);
    setSearchOpen(open);
  }

  function onShownPhotos(photos: Photo[]) {
    shownPhotosRef.current = photos;
    if (creditsOpenRef.current) setCreditPhotos(photos);
  }

  function onShownVideos(videos: VideoClip[]) {
    shownVideosRef.current = videos;
    if (creditsOpenRef.current) setCreditVideos(videos);
  }

  return (
    <div
      className={`relative min-h-screen${pick && controlsIdle ? " is-controls-idle" : ""}${showCredits ? " is-credits" : ""}`}
    >
      <Visualizer
        key={pick?.pickId ?? 0}
        song={song}
        playback={playback}
        holdPhotos={holdPhotos}
        previewMode={
          previewMode ||
          (phoneLayout === true && !passedPreview && Boolean(song))
        }
        allowClips={phoneLayout === false || passedPreview}
        layoutReady={phoneLayout !== null}
        visualMode={song?.lyricsType === "none" ? "photos" : visualMode}
        colorMode={colorMode}
        onShownPhotos={onShownPhotos}
        onShownVideos={onShownVideos}
      />
      {showNoLyricsSentence && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[6] bg-[var(--color-bg-black)]"
        />
      )}
      {showNoLyricsSentence && (
        <div className="no-lyrics-overlay">
          <NoLyricsMessage />
        </div>
      )}
      {/* Credits keep the search. The player and filters sit behind
          the black panel, so they should not take clicks or focus. */}
      <div className={pick ? "home-controls has-player" : undefined}>
        {pick && (
          <main
            className={`home-player${playerIn ? " is-in" : ""}`}
            inert={showCredits ? true : undefined}
          >
            <div className="home-player-clip">
              <PlayerBar
                key={pick.pickId}
                selection={pick.hit}
                onSong={onSong}
                onPlayback={onPlayback}
                previewMode={previewMode}
                playerCommand={playerCommand}
                onVisibleChange={onPlayerVisible}
              />
            </div>
          </main>
        )}
        <div className={pick ? "home-controls-lower" : undefined}>
          <div
            className="home-search-slot"
            inert={pick && controlsIdle && !showCredits ? true : undefined}
          >
            <SearchBox onSelect={onSelect} onOpenChange={onSearchOpenChange} />
          </div>
          {!pick && !searchOpen && <HomeIntro />}
          {pick && (
            <div className="toggle-slot" inert={showCredits ? true : undefined}>
              <div className="toggle-slot-clip">
                <div className="toggle-row">
                  <VisualModeToggle
                    mode={visualMode}
                    onChange={onVisualMode}
                    photosOnly={song?.lyricsType === "none"}
                  />
                  <ColorModeToggle mode={colorMode} onChange={onColorMode} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {showCredits && song && (
        <Credits song={song} photos={creditPhotos} videos={creditVideos} />
      )}
      <AboutButton />
    </div>
  );
}

function HomeIntro() {
  return (
    <div className="home-intro">
      <div className="home-intro-copy">
        <h1 className="home-intro-title">
          Music and imagery,{" "}
          <span className="home-intro-title-quiet">matched by their words</span>
        </h1>
        <p className="home-intro-text">
          What happens when you pair music with images that were never
          meant to be together?
        </p>
      </div>
    </div>
  );
}

const VISUAL_MODE_KEY = "lyric-visualizer:visual-mode";

/** What they last chose in this visit. Photos & Videos if they haven't chosen. */
function readVisualMode(): VisualMode {
  try {
    const stored = sessionStorage.getItem(VISUAL_MODE_KEY);
    if (stored === "photos" || stored === "video" || stored === "mix") {
      return stored;
    }
  } catch {
    // Some private windows block storage. Photos & Videos still works.
  }
  return "mix";
}

function rememberVisualMode(mode: VisualMode) {
  try {
    sessionStorage.setItem(VISUAL_MODE_KEY, mode);
  } catch {
    // The choice still applies until they leave the page.
  }
}

const COLOR_MODE_KEY = "lyric-visualizer:color-mode";

/** Black and white unless they chose color earlier in this visit. */
function readColorMode(): ColorMode {
  try {
    const stored = sessionStorage.getItem(COLOR_MODE_KEY);
    if (stored === "bw" || stored === "color") return stored;
  } catch {
    // Some private windows block storage. Black and white still works.
  }
  return "bw";
}

function rememberColorMode(mode: ColorMode) {
  try {
    sessionStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    // The choice still applies until they leave the page.
  }
}

/**
 * Photos & Videos, Photos, or Videos.
 * Photos & Videos plays a clip when a word comes back, like a chorus, and
 * photos the rest of the time. Photo is stills. Video is a clip wherever
 * one exists, with a photo filling in when it doesn't.
 * No lyrics means there is nothing to cut a clip to, so only Photo works.
 * The saved choice is left alone for the next song.
 */
function VisualModeToggle({
  mode,
  onChange,
  photosOnly = false,
}: {
  mode: VisualMode;
  onChange: (mode: VisualMode) => void;
  photosOnly?: boolean;
}) {
  const options: { id: VisualMode; label: string }[] = [
    { id: "mix", label: "Photos & Videos" },
    { id: "photos", label: "Photos" },
    { id: "video", label: "Videos" },
  ];
  const shown = photosOnly ? "photos" : mode;

  return (
    <SegmentedControl
      label="Photos and videos"
      className="toggle-bar-media"
      options={options}
      value={shown}
      onChange={(next) => {
        if (photosOnly) return;
        onChange(next);
      }}
      isDisabled={(id) => photosOnly && id !== "photos"}
      disabledHint={photosOnly ? "Only available with lyrics" : undefined}
    />
  );
}

/** Black & White or Color. Black and white is the start. */
function ColorModeToggle({
  mode,
  onChange,
}: {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
}) {
  const options: { id: ColorMode; label: string }[] = [
    { id: "bw", label: "Black & White" },
    { id: "color", label: "Color" },
  ];

  return (
    <SegmentedControl
      label="Black and white or color"
      className="toggle-bar-color"
      options={options}
      value={mode}
      onChange={onChange}
    />
  );
}

/**
 * One rounded bar of options. Only one can be selected.
 * The checkmark sits on the selected label, so that option grows a little.
 */
function SegmentedControl<T extends string>({
  label,
  className,
  options,
  value,
  onChange,
  isDisabled,
  disabledHint,
}: {
  label: string;
  className: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  isDisabled?: (id: T) => boolean;
  /** Shown when hovering an option that `isDisabled` turns off. */
  disabledHint?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function selectAt(index: number) {
    const option = options[index];
    if (!option || isDisabled?.(option.id)) return;
    onChange(option.id);
    buttons.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;

    event.preventDefault();
    const current = Math.max(
      0,
      options.findIndex((option) => option.id === value),
    );
    const direction = forward ? 1 : -1;

    for (let step = 1; step <= options.length; step += 1) {
      const index =
        (current + direction * step + options.length) % options.length;
      if (isDisabled?.(options[index].id)) continue;
      selectAt(index);
      return;
    }
  }

  return (
    <div
      className={`toggle-bar ${className}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        const disabled = isDisabled?.(option.id) ?? false;
        const hint = disabled ? disabledHint : undefined;
        const button = (
          <button
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            aria-description={hint}
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            className={`toggle-option${selected ? " is-selected" : ""}`}
            onClick={() => selectAt(index)}
          >
            {selected && <CheckIcon />}
            <span>{option.label}</span>
          </button>
        );
        if (!hint) {
          return (
            <span key={option.id} className="toggle-option-slot">
              {button}
            </span>
          );
        }
        return (
          <DisabledOptionHint key={option.id} hint={hint}>
            {button}
          </DisabledOptionHint>
        );
      })}
    </div>
  );
}

/**
 * Disabled buttons do not receive hover, so the hint sits on a wrapper.
 * Drawn on the page body so the control row's clipping cannot cut it off.
 */
function DisabledOptionHint({
  hint,
  children,
}: {
  hint: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const tick = () => {
      const el = wrapRef.current;
      if (!el || !el.matches(":hover")) {
        setOpen(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const hintWidth = hintRef.current?.offsetWidth ?? 0;
      const margin = 8;
      const half = hintWidth / 2;
      const center = rect.left + rect.width / 2;
      const left =
        hintWidth > 0
          ? Math.min(
              Math.max(center, margin + half),
              window.innerWidth - margin - half,
            )
          : center;
      const top = rect.bottom + 8;
      setPlace((prev) => {
        if (
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.left - left) < 0.5
        ) {
          return prev;
        }
        return { top, left };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="toggle-option-slot"
      onMouseEnter={() => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPlace({
          top: rect.bottom + 8,
          left: rect.left + rect.width / 2,
        });
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={hintRef}
            role="tooltip"
            className="toggle-hint"
            style={{ top: place.top, left: place.left }}
          >
            {hint}
          </span>,
          document.body,
        )}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="toggle-check">
      <path
        d="M3.6 9.2 7.1 12.6 14.4 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function needsNoLyricsMessage(song: SongPackage | null): boolean {
  return (
    song != null &&
    song.lyricsType === "none" &&
    song.scenes.some((scene) => scene.photos.length > 0)
  );
}
