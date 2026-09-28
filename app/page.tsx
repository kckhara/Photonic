"use client";

import { useEffect, useRef, useState } from "react";
import { Credits } from "@/components/Credits";
import { NoLyricsMessage, NO_LYRICS_MESSAGE_MS } from "@/components/NoLyricsMessage";
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
import type { Photo, PlaybackSample, SongPackage } from "@/lib/types";

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
  // True while the credits screen is up, so a second "ended" report
  // doesn't open it again.
  const creditsOpenRef = useRef(false);
  const noLyricsTimer = useRef<number | null>(null);
  // So the no-lyrics sentence only plays once per song.
  const noLyricsShownRef = useRef(false);
  const reportedDurationRef = useRef<number | null>(null);
  // True once the playhead has been in the last second. The next reading
  // can then notice a jump back to the start.
  const nearEndRef = useRef(false);
  // Skip end detection for the sample that "Play again" or "Reload" just caused.
  const ignoreEndRef = useRef(false);
  const acceptPlaybackAfterRef = useRef(0);
  const commandNonce = useRef(0);
  const songRef = useRef<SongPackage | null>(null);
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

  useEffect(() => {
    songRef.current = song;
    previewModeRef.current = previewMode;
  });

  useEffect(() => {
    return () => {
      if (noLyricsTimer.current == null) return;
      window.clearTimeout(noLyricsTimer.current);
    };
  }, []);

  function clearNoLyricsTimer() {
    if (noLyricsTimer.current == null) return;
    window.clearTimeout(noLyricsTimer.current);
    noLyricsTimer.current = null;
  }

  function setStep(step: LoginPromptStep) {
    promptStepRef.current = step;
    setPromptStep(step);
  }

  // The short "we can't find lyrics" sentence. Skipped during a preview —
  // the login panel is the message in that case.
  function beginSentence() {
    if (noLyricsShownRef.current || previewModeRef.current) return;
    if (!needsNoLyricsMessage(songRef.current)) return;
    noLyricsShownRef.current = true;
    clearNoLyricsTimer();
    setShowNoLyricsSentence(true);
    setHoldPhotos(true);
    noLyricsTimer.current = window.setTimeout(() => {
      noLyricsTimer.current = null;
      setShowNoLyricsSentence(false);
      setHoldPhotos(false);
    }, NO_LYRICS_MESSAGE_MS);
  }

  function enterPreview() {
    previewModeRef.current = true;
    setPreviewMode(true);
    clearNoLyricsTimer();
    setShowNoLyricsSentence(false);
    setHoldPhotos(false);
    // If they later reload into the full song, the sentence can still show.
    noLyricsShownRef.current = false;
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
    if (needsNoLyricsMessage(songRef.current)) beginSentence();
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
    setShowCredits(true);
  }

  function closeCredits() {
    creditsOpenRef.current = false;
    setShowCredits(false);
    setCreditPhotos([]);
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
    clearNoLyricsTimer();
    noLyricsShownRef.current = false;
    songRef.current = null;
    setHoldPhotos(false);
    setShowNoLyricsSentence(false);
    closeCredits();
    setPick({ hit, pickId: nextPickId.current });
    setSong(null);
    setPlayback(null);
    resetPreviewState();
    shownPhotosRef.current = [];
  }

  function onSong(next: SongPackage | null) {
    songRef.current = next;
    setSong(next);
    clearNoLyricsTimer();
    noLyricsShownRef.current = false;
    setShowNoLyricsSentence(false);

    if (!needsNoLyricsMessage(next)) {
      setHoldPhotos(false);
      return;
    }

    // Hold the photos briefly. If this is a preview, playback will
    // cancel the sentence. If Spotify never answers, show it anyway.
    setHoldPhotos(true);
    noLyricsTimer.current = window.setTimeout(() => {
      noLyricsTimer.current = null;
      beginSentence();
    }, 2000);
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
    clearNoLyricsTimer();
    noLyricsShownRef.current = false;
    songRef.current = null;
    setHoldPhotos(false);
    setShowNoLyricsSentence(false);
    closeCredits();
    setPick(null);
    setSong(null);
    setPlayback(null);
    resetPreviewState();
    shownPhotosRef.current = [];
    setSearchResetKey((current) => current + 1);
  }

  function onShownPhotos(photos: Photo[]) {
    shownPhotosRef.current = photos;
    if (creditsOpenRef.current) setCreditPhotos(photos);
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
        onShownPhotos={onShownPhotos}
      />
      {/* A light darkening, stronger near the words, so the photo stays
          visible and the search text can still be read on top of it. */}
      {darkScreen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1] bg-gradient-to-b from-black/70 via-black/20 to-black/30"
        />
      )}
      <main
        // While credits cover the page, the search and player behind
        // them should not take clicks or keyboard focus.
        inert={showCredits ? true : undefined}
        className={`relative z-10 mx-auto flex w-full max-w-xl flex-col px-6 py-16 ${
          darkScreen ? "text-white" : ""
        }`}
      >
        <h1 className="mb-6 text-2xl font-semibold">Lyric Visualizer</h1>
        <SearchBox onSelect={onSelect} resetKey={searchResetKey} />
        {showNoLyricsSentence && !previewMode && (
          <div className="mt-10">
            <NoLyricsMessage />
          </div>
        )}
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
          onPlayAgain={onPlayCreditsAgain}
          onNewSearch={onNewSearch}
        />
      )}
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
