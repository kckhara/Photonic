"use client";

import { useEffect, useRef, useState } from "react";
import { Credits } from "@/components/Credits";
import { NoLyricsMessage, NO_LYRICS_INTRO_MS } from "@/components/NoLyricsMessage";
import { PlayerBar, type PlayerCommand } from "@/components/PlayerBar";
import { SearchBox } from "@/components/SearchBox";
import {
  SpotifyLoginPrompt,
  type LoginPromptStep,
} from "@/components/SpotifyLoginPrompt";
import { Visualizer } from "@/components/Visualizer";
import type { SearchHit } from "@/lib/deezer";
import {
  classifyPlayback,
  playbackHasEnded,
  rememberLoginPromptDismissed,
  wasLoginPromptDismissed,
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
 * Homepage: search, then the player, with photos filling the screen behind them.
 * This file runs in the browser because it has to remember the chosen song.
 *
 * If Spotify is only playing a 30-second preview, a small login panel
 * appears near the player. Photos keep playing behind it. See section 5.6.
 *
 * When a full song finishes, a credits screen covers the page. A preview
 * never uses that screen — its ending stays on the login panel.
 */
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
  const commandNonce = useRef(0);
  const songRef = useRef<SongPackage | null>(null);
  const playbackRef = useRef<PlaybackSample | null>(null);
  const previewModeRef = useRef(false);
  const heardPlaybackRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const promptStepRef = useRef<LoginPromptStep>("invite");
  const lastVerdictRef = useRef<PlaybackKind>("unknown");
  // null until the first render in the browser, then true or false.
  // The homepage doesn't show the prompt yet, so this stays out of the HTML.
  const loginDismissedRef = useRef<boolean | null>(null);
  if (loginDismissedRef.current == null) {
    loginDismissedRef.current =
      typeof window === "undefined" ? false : wasLoginPromptDismissed();
  }

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
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptStep, setPromptStep] = useState<LoginPromptStep>("invite");
  const [playerCommand, setPlayerCommand] = useState<PlayerCommand | null>(null);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [showCredits, setShowCredits] = useState(false);
  // Copied when the song ends, then updated if the last photo finishes
  // fading in a moment later.
  const [creditPhotos, setCreditPhotos] = useState<Photo[]>([]);
  const [creditVideos, setCreditVideos] = useState<VideoClip[]>([]);
  // Photos, and black and white, until we can read what they chose
  // earlier in this visit.
  const [visualMode, setVisualMode] = useState<VisualMode>("photos");
  const [colorMode, setColorMode] = useState<ColorMode>("bw");

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

  function setStep(step: LoginPromptStep) {
    promptStepRef.current = step;
    setPromptStep(step);
  }

  function enterPreview() {
    previewModeRef.current = true;
    setPreviewMode(true);
    // The login panel can sit on the black screen. The sentence still
    // follows the playhead, so the first 5 seconds stay quiet.
    if (promptStepRef.current === "ended") {
      setPromptOpen(true);
      return;
    }
    if (!loginDismissedRef.current) setPromptOpen(true);
  }

  function enterFullSong() {
    previewModeRef.current = false;
    setPreviewMode(false);
    setPromptOpen(false);
    setStep("invite");
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
      // Leave the "Reload player" step up if they already opened login.
      // A preview must never open the credits screen.
      if (promptStepRef.current === "reload" || promptStepRef.current === "ended") {
        return;
      }
      setStep("ended");
      setPromptOpen(true);
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
    // Preview mode keeps the login panel. Credits are for a full song.
    if (creditsOpenRef.current || previewModeRef.current || !songRef.current) {
      return;
    }
    creditsOpenRef.current = true;
    setCreditPhotos(shownPhotosRef.current);
    setCreditVideos(shownVideosRef.current);
    setShowCredits(true);
  }

  function closeCredits() {
    creditsOpenRef.current = false;
    setShowCredits(false);
    setCreditPhotos([]);
    setCreditVideos([]);
  }

  function applyVerdict(verdict: PlaybackKind) {
    if (verdict === "unknown" || verdict === lastVerdictRef.current) return;
    lastVerdictRef.current = verdict;
    if (verdict === "preview") enterPreview();
    else enterFullSong();
  }

  function resetPreviewState() {
    heardPlaybackRef.current = false;
    previewModeRef.current = false;
    pendingReloadRef.current = false;
    lastVerdictRef.current = "unknown";
    reportedDurationRef.current = null;
    nearEndRef.current = false;
    ignoreEndRef.current = false;
    acceptPlaybackAfterRef.current = 0;
    setPreviewMode(false);
    setPromptOpen(false);
    setStep("invite");
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
    if (!sample) return;
    if (sample.isPlaying) heardPlaybackRef.current = true;

    const currentSong = songRef.current;
    if (!currentSong || !heardPlaybackRef.current) return;

    // "Reload player" — ignore the old embed, then judge the new one.
    if (pendingReloadRef.current) {
      if (sample.receivedAt < acceptPlaybackAfterRef.current) return;
      // Wait until this new embed reports its own length. An older
      // 30-second reading must not decide the question.
      if (!sample.reportedDurationMs) return;
      const verdict = classifyPlayback(
        currentSong.durationMs,
        sample.reportedDurationMs,
      );
      if (verdict === "unknown") return;
      pendingReloadRef.current = false;
      lastVerdictRef.current = "unknown";
      // Still a preview: go back to the first message. A full song
      // clears the panel in enterFullSong.
      if (verdict === "preview" && promptStepRef.current === "reload") {
        setStep("invite");
      }
      applyVerdict(verdict);
      return;
    }

    applyVerdict(
      classifyPlayback(currentSong.durationMs, reportedDurationRef.current),
    );

    // A preview ends on the login panel. A full song ends on credits.
    // "Unknown" means Spotify hasn't reported a length yet, so we wait.
    if (lastVerdictRef.current === "preview") considerPreviewEnd(sample);
    else if (lastVerdictRef.current === "full") considerSongEnd(sample);
  }

  function onLogin() {
    setStep("reload");
    setPromptOpen(true);
  }

  function onMaybeLater() {
    rememberLoginPromptDismissed();
    loginDismissedRef.current = true;
    setPromptOpen(false);
  }

  function onShowLoginPrompt() {
    setPromptOpen(true);
  }

  function onReloadPlayer() {
    const positionMs = Math.max(0, estimatePositionMs(playback));
    acceptPlaybackAfterRef.current = performance.now();
    ignoreEndRef.current = true;
    nearEndRef.current = false;
    pendingReloadRef.current = true;
    setStep("reload");
    setPromptOpen(true);
    commandNonce.current += 1;
    setPlayerCommand({
      kind: "reload",
      nonce: commandNonce.current,
      positionMs,
    });
  }

  // Seek back to the start and play. The next "ended" reading is ignored
  // until the music is actually moving again, so the jump to 0 doesn't
  // look like another ending.
  function restartPlayback() {
    acceptPlaybackAfterRef.current = performance.now();
    ignoreEndRef.current = true;
    nearEndRef.current = false;
    commandNonce.current += 1;
    setPlayerCommand({ kind: "restart", nonce: commandNonce.current });
  }

  function onPlayAgain() {
    restartPlayback();
    setStep("invite");
    setPromptOpen(!loginDismissedRef.current);
  }

  function onPlayCreditsAgain() {
    closeCredits();
    restartPlayback();
  }

  function onNewSearch() {
    songRef.current = null;
    setHoldPhotos(false);
    setShowNoLyricsSentence(false);
    closeCredits();
    setPick(null);
    setSong(null);
    setPlayback(null);
    resetPreviewState();
    shownPhotosRef.current = [];
    shownVideosRef.current = [];
    setSearchResetKey((current) => current + 1);
  }

  function onShownPhotos(photos: Photo[]) {
    shownPhotosRef.current = photos;
    if (creditsOpenRef.current) setCreditPhotos(photos);
  }

  function onShownVideos(videos: VideoClip[]) {
    shownVideosRef.current = videos;
    if (creditsOpenRef.current) setCreditVideos(videos);
  }

  // White words need a dark full-screen behind them. That's the photos,
  // the opening title card, or the black screen under the no-lyrics sentence.
  // A failed load has none of those, so the words stay the normal color.
  const hasPhotos =
    song?.scenes.some((scene) => scene.photos.length > 0) ?? false;
  const darkScreen =
    holdPhotos || (song != null && (song.lyricsType !== "none" || hasPhotos));

  return (
    <div className="relative min-h-screen">
      <Visualizer
        key={pick?.pickId ?? 0}
        song={song}
        playback={playback}
        holdPhotos={holdPhotos}
        previewMode={previewMode}
        visualMode={song?.lyricsType === "none" ? "photos" : visualMode}
        colorMode={colorMode}
        onShownPhotos={onShownPhotos}
        onShownVideos={onShownVideos}
      />
      {/* A light darkening, stronger near the words, so the photo stays
          visible and the search text can still be read on top of it. */}
      {darkScreen && !showNoLyricsSentence && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1] bg-gradient-to-b from-[var(--color-bg-black)]/70 via-[var(--color-bg-black)]/20 to-[var(--color-bg-black)]/30"
        />
      )}
      {showNoLyricsSentence && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[6] bg-[var(--color-bg-black)]"
        />
      )}
      <main
        // While credits cover the page, the search and player behind
        // them should not take clicks or keyboard focus.
        inert={showCredits ? true : undefined}
        className="relative z-10 mx-auto flex w-full max-w-xl flex-col px-6 py-16 [color:var(--color-text-primary)]"
      >
        <h1 className="mb-6 [font-family:var(--font-family-display)] [font-size:var(--font-size-homepage-header)] [font-weight:var(--font-weight-homepage-header)] [line-height:var(--line-height-homepage-header)] [letter-spacing:var(--letter-spacing-homepage-header)] [color:var(--color-text-primary)]">
          Lyric Visualizer
        </h1>
        <SearchBox onSelect={onSelect} resetKey={searchResetKey} />
        {showNoLyricsSentence && (
          <div className="mt-10 text-center">
            <NoLyricsMessage />
          </div>
        )}
        {pick && (
          <VisualModeToggle
            mode={visualMode}
            onChange={onVisualMode}
            photosOnly={song?.lyricsType === "none"}
          />
        )}
        {pick && <ColorModeToggle mode={colorMode} onChange={onColorMode} />}
        {pick && (
          <PlayerBar
            key={pick.pickId}
            selection={pick.hit}
            onSong={onSong}
            onPlayback={onPlayback}
            previewMode={previewMode}
            onShowLoginPrompt={onShowLoginPrompt}
            playerCommand={playerCommand}
          />
        )}
        {promptOpen && previewMode && (
          <div className="mt-4">
            <SpotifyLoginPrompt
              step={promptStep}
              onLogin={onLogin}
              onMaybeLater={onMaybeLater}
              onReload={onReloadPlayer}
              onPlayAgain={onPlayAgain}
              onNewSearch={onNewSearch}
            />
          </div>
        )}
      </main>
      {showCredits && song && (
        <Credits
          song={song}
          photos={creditPhotos}
          videos={creditVideos}
          onPlayAgain={onPlayCreditsAgain}
          onNewSearch={onNewSearch}
        />
      )}
    </div>
  );
}

const VISUAL_MODE_KEY = "lyric-visualizer:visual-mode";

/** What they last chose in this visit. Photos if they haven't chosen. */
function readVisualMode(): VisualMode {
  try {
    const stored = sessionStorage.getItem(VISUAL_MODE_KEY);
    if (stored === "photos" || stored === "video" || stored === "mix") {
      return stored;
    }
  } catch {
    // Some private windows block storage. Photos still works.
  }
  return "photos";
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
 * Photos, Video, or Mix. Plain on purpose — the real design is Phase 10.
 * Mix plays clips only on words that repeat, like a chorus.
 */
function VisualModeToggle({
  mode,
  onChange,
  photosOnly = false,
}: {
  mode: VisualMode;
  onChange: (mode: VisualMode) => void;
  // No lyrics means there is nothing to cut a clip to, so only Photos works.
  // The saved Video or Mix choice is left alone for the next song.
  photosOnly?: boolean;
}) {
  const options: { id: VisualMode; label: string }[] = [
    { id: "photos", label: "Photos" },
    { id: "video", label: "Video" },
    { id: "mix", label: "Mix" },
  ];
  const shown = photosOnly ? "photos" : mode;

  return (
    <div className="mt-6">
      <div className="flex gap-2" role="group" aria-label="Photos, video, or mix">
        {options.map((option) => {
          const selected = option.id === shown;
          const unavailable = photosOnly && option.id !== "photos";
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              aria-disabled={unavailable}
              disabled={unavailable}
              onClick={() => {
                // Photos is already on. Don't overwrite a saved Video or Mix choice.
                if (photosOnly) return;
                onChange(option.id);
              }}
              className={`rounded-[var(--radius-toggle-option)] px-3 py-2 [font-size:var(--font-size-toggle)] [font-weight:var(--font-weight-toggle)] [line-height:var(--line-height-toggle)] [letter-spacing:var(--letter-spacing-toggle)] ${
                selected
                  ? "bg-[var(--color-selected-segment)] text-[color:var(--color-text-on-selected)]"
                  : "border-[length:var(--border-width)] border-solid [border-color:var(--color-outline)] text-[color:var(--color-text-primary)]"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
        {photosOnly
          ? "No lyrics for this song, so only photos play."
          : shown === "mix"
            ? "Video on words that repeat, like a chorus. Photos on the rest."
            : shown === "video"
              ? "Clips where we have them. Photos fill in the rest."
              : "Still photos, timed to the song."}
      </p>
    </div>
  );
}

/**
 * Black & white or color, for the photos and clips behind the page.
 * Same buttons as Photos / Video / Mix. Black and white is the start.
 */
function ColorModeToggle({
  mode,
  onChange,
}: {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
}) {
  const options: { id: ColorMode; label: string }[] = [
    { id: "bw", label: "Black & white" },
    { id: "color", label: "Color" },
  ];

  return (
    <div className="mt-4">
      <div
        className="flex gap-2"
        role="group"
        aria-label="Black and white or color"
      >
        {options.map((option) => {
          const selected = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`rounded-[var(--radius-toggle-option)] px-3 py-2 [font-size:var(--font-size-toggle)] [font-weight:var(--font-weight-toggle)] [line-height:var(--line-height-toggle)] [letter-spacing:var(--letter-spacing-toggle)] ${
                selected
                  ? "bg-[var(--color-selected-segment)] text-[color:var(--color-text-on-selected)]"
                  : "border-[length:var(--border-width)] border-solid [border-color:var(--color-outline)] text-[color:var(--color-text-primary)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
        {mode === "color"
          ? "Photos and clips in color."
          : "Photos and clips in black and white."}
      </p>
    </div>
  );
}

function needsNoLyricsMessage(song: SongPackage | null): boolean {
  return (
    song != null &&
    song.lyricsType === "none" &&
    song.scenes.some((scene) => scene.photos.length > 0)
  );
}
