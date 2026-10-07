"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchHit } from "@/lib/deezer";
import type { PlaybackSample, SongPackage } from "@/lib/types";

// Spotify's compact player is 152px. A shorter slot crops the album art.
const EMBED_HEIGHT = "152";

// A reported length under this is a preview, not the full song.
// Matches the cutoff in lib/preview.ts.
const PREVIEW_EMBED_MS = 35_000;

// How long a "playing" report can sit still before we stop trusting it.
// Spotify speaks about once a second. A few quiet seconds means the
// playhead is stuck: audio never started, or the preview finished and
// Spotify left the pause flag off.
const STALL_MS = 4_000;

// What Spotify sends on playback_update. Times are in milliseconds.
type PlaybackUpdate = {
  isPaused?: boolean;
  isBuffering?: boolean;
  duration?: number;
  position?: number;
};

// The small remote Spotify gives us so our buttons can control the embed.
// No API keys are involved — this is Spotify's public player.
type EmbedController = {
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  addListener: (
    event: string,
    handler: (event: { data?: PlaybackUpdate } | PlaybackUpdate) => void,
  ) => void;
};

type IFrameAPI = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width?: string; height?: string },
    callback: (controller: EmbedController) => void,
  ) => void;
};

// Kept separate from the /test page's types. Both talk to the same
// Spotify script, but they don't have to share one TypeScript shape.
type SpotifyGlobals = {
  onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
  __SPOTIFY_IFRAME_API__?: IFrameAPI;
};

function spotifyGlobals(): SpotifyGlobals {
  return window as unknown as SpotifyGlobals;
}

type LoadStatus = "loading" | "ready" | "error";

// The page asks the player to do one of these. `nonce` changes every
// request so the same action can run again (play again, then play again).
export type PlayerCommand =
  | { kind: "reload"; nonce: number; positionMs: number }
  | { kind: "restart"; nonce: number };

/**
 * Sits at the top of the page after a song or musician is chosen.
 * Loads that song from our server, then plays it on Spotify.
 * Tells the page when the song package arrives, and where playback is,
 * so the photos can follow along.
 */
export function PlayerBar({
  selection,
  onSong,
  onPlayback,
  previewMode = false,
  playerCommand = null,
  onVisibleChange,
}: {
  selection: SearchHit;
  onSong: (song: SongPackage | null) => void;
  onPlayback: (playback: PlaybackSample | null) => void;
  // True while Spotify is only playing a 30-second preview.
  previewMode?: boolean;
  // Reload the embed, or send the preview back to the start.
  playerCommand?: PlayerCommand | null;
  // True once the Spotify embed is on the page.
  onVisibleChange?: (visible: boolean) => void;
}) {
  // Kept in refs so a new render doesn't restart the song load.
  const onSongRef = useRef(onSong);
  const onPlaybackRef = useRef(onPlayback);
  const onVisibleChangeRef = useRef(onVisibleChange);

  useEffect(() => {
    onSongRef.current = onSong;
    onPlaybackRef.current = onPlayback;
    onVisibleChangeRef.current = onVisibleChange;
  });
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [song, setSong] = useState<SongPackage | null>(null);
  const [message, setMessage] = useState(() => loadingMessage(selection));
  // A new generation throws away the Spotify embed and builds a fresh one,
  // so a login in another tab can take effect. startAtMs is where to resume.
  // autoplay is off after a reset, so the play button is waiting for a click
  // instead of starting another clip that Spotify will cover up.
  const [playerSlot, setPlayerSlot] = useState({
    generation: 0,
    startAtMs: 0,
    autoplay: true,
  });
  // Stops a stuck embed from rebuilding itself in a loop.
  const lastResetAt = useRef(0);
  const [restartNonce, setRestartNonce] = useState(0);
  const [handledNonce, setHandledNonce] = useState<number | null>(null);

  // Apply each request once, as soon as it arrives, so the embed
  // rebuilds in the same turn as the click.
  if (playerCommand && playerCommand.nonce !== handledNonce) {
    setHandledNonce(playerCommand.nonce);
    if (playerCommand.kind === "reload") {
      setPlayerSlot((current) => ({
        generation: current.generation + 1,
        startAtMs: Math.max(0, playerCommand.positionMs),
        autoplay: true,
      }));
    } else {
      setRestartNonce(playerCommand.nonce);
    }
  }

  // Each new choice starts a fresh load. If the person picks something else
  // before this finishes, we cancel so an old result can't overwrite the new one.
  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setSong(null);
      setMessage(loadingMessage(selection));
      // Clear the previous song so its photos don't linger.
      onSongRef.current(null);
      onPlaybackRef.current(null);

      try {
        const deezerId = await resolveDeezerId(selection, abort.signal);
        if (cancelled) return;

        if (deezerId === null) {
          setStatus("error");
          setMessage(
            "We couldn’t find a top song for this musician. Try choosing a song instead.",
          );
          return;
        }

        const nextSong = await fetchSongPackage(deezerId, abort.signal);
        if (cancelled) return;

        setSong(nextSong);
        setStatus("ready");
        onSongRef.current(nextSong);
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        setStatus("error");
        // Only show sentences we wrote. A network failure or a surprise
        // from the server becomes one plain line, not a raw error.
        setMessage(friendlyLoadMessage(error));
      }
    }

    load();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [selection]);

  function resetPlayer(positionMs: number) {
    const now = performance.now();
    if (now - lastResetAt.current < STALL_MS) return;
    lastResetAt.current = now;
    setPlayerSlot((current) => ({
      generation: current.generation + 1,
      startAtMs: Math.max(0, positionMs),
      autoplay: false,
    }));
  }

  const playerVisible = status === "ready" && Boolean(song?.spotifyId);

  useEffect(() => {
    onVisibleChangeRef.current?.(playerVisible);
  }, [playerVisible]);

  const notices = screenNotices(status, message, song);

  return (
    <>
      <ScreenNotices notices={notices} />
      <section className="spotify-slot" aria-label="Player">
        {status === "ready" && song?.spotifyId && (
          <SpotifyPlayer
            key={playerSlot.generation}
            spotifyId={song.spotifyId}
            startAtMs={playerSlot.startAtMs}
            autoplay={playerSlot.autoplay}
            restartNonce={restartNonce}
            onPlayback={(sample) => onPlaybackRef.current(sample)}
            onReset={resetPlayer}
          />
        )}
      </section>
      <div className={`spotify-hint-slot${previewMode ? " is-in" : ""}`}>
        <div className="spotify-hint-clip">
          <PreviewLoginHint />
        </div>
      </div>
    </>
  );
}

/**
 * The Spotify embed plus our Play/Pause and skip buttons.
 * Rendered only after we know the Spotify track id.
 */
function SpotifyPlayer({
  spotifyId,
  startAtMs,
  autoplay,
  restartNonce,
  onPlayback,
  onReset,
}: {
  spotifyId: string;
  // 0 on a normal song start. After "Reload player", the moment to jump back to.
  startAtMs: number;
  // False after the embed got stuck. Wait for a click on Spotify's play button.
  autoplay: boolean;
  restartNonce: number;
  onPlayback: (playback: PlaybackSample | null) => void;
  // Build a fresh embed, parked at this moment, and wait for a click.
  // Spotify's preview replaces the play button with a signup card when
  // the clip pauses or ends, and that card does not play or pause.
  onReset: (positionMs: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const playbackRef = useRef<PlaybackUpdate | null>(null);
  // The last position we told the photos about, including pause and skip.
  const sampleRef = useRef<PlaybackSample | null>(null);
  const onPlaybackRef = useRef(onPlayback);
  const onResetRef = useRef(onReset);
  // So "Play again" doesn't also run on the first render, or again
  // when "Reload player" builds a brand-new embed.
  const seenRestart = useRef(restartNonce);

  useEffect(() => {
    onPlaybackRef.current = onPlayback;
    onResetRef.current = onReset;
  });

  function publish(sample: PlaybackSample | null) {
    sampleRef.current = sample;
    onPlaybackRef.current(sample);
  }

  function emit(data: PlaybackUpdate | null, positionMs: number, isPlaying: boolean) {
    publish({
      positionMs,
      isPlaying,
      isPaused: data?.isPaused === true,
      receivedAt: performance.now(),
      reportedDurationMs: reportedDuration(data, sampleRef.current),
    });
  }

  const emitRef = useRef(emit);

  useEffect(() => {
    emitRef.current = emit;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Spotify swaps this empty div for its iframe, so start clean every time.
    const element = document.createElement("div");
    host.replaceChildren(element);

    let cancelled = false;
    let stallTimer = 0;

    function onApiReady(api: IFrameAPI) {
      const spotifyWindow = spotifyGlobals();
      spotifyWindow.__SPOTIFY_IFRAME_API__ = api;
      if (cancelled) return;

      api.createController(
        element,
        {
          uri: `spotify:track:${spotifyId}`,
          width: "100%",
          height: EMBED_HEIGHT,
        },
        (controller) => {
          if (cancelled) {
            destroyController(controller);
            return;
          }

          controllerRef.current = controller;

          // "Reload player" builds a new embed. Spotify starts it at 0,
          // so we jump back to the moment they were hearing.
          let seekAttempts = 0;
          function resumeAtSavedPosition(currentPositionMs?: number) {
            if (cancelled || startAtMs <= 500) return;
            if (
              currentPositionMs != null &&
              Math.abs(currentPositionMs - startAtMs) < 1500
            ) {
              return;
            }
            if (seekAttempts >= 2) return;
            seekAttempts += 1;
            controller.seek(startAtMs / 1000);
            if (autoplay) tryPlay(controller);
          }

          // Spotify sometimes says "playing" after the clip has finished, and
          // covers the play button with a signup card. It can also say
          // "playing" when the browser never started the audio. Either way
          // the playhead stops moving. We hold the photos and swap in a
          // fresh player whose play button still works.
          let lastPosition: number | null = null;
          let recovered = false;
          // True once the playhead has actually moved. A fresh embed
          // opens already paused, and that must not rebuild the player.
          let heardPlaying = false;

          function recover(positionMs: number) {
            if (cancelled || recovered) return;
            recovered = true;
            window.clearTimeout(stallTimer);
            onResetRef.current(positionMs);
          }

          function armStallTimer(data: PlaybackUpdate, positionMs: number) {
            window.clearTimeout(stallTimer);
            stallTimer = window.setTimeout(() => {
              if (cancelled || recovered) return;
              // Spotify sometimes goes quiet for a few seconds in the
              // middle of a song. That is not a pause. Stopping the
              // clock there leaves whatever picture just appeared stuck
              // while the music continues.
              if (positionMs >= 1500) return;
              emitRef.current(
                { ...data, isPaused: true, position: positionMs },
                positionMs,
                false,
              );
              if (autoplay) recover(0);
            }, STALL_MS);
          }

          controller.addListener("playback_update", (event) => {
            // Ignore reports from a player we're already tearing down.
            if (cancelled) return;

            const data = readPlayback(event);
            playbackRef.current = data;
            const positionMs =
              typeof data.position === "number" ? data.position : 0;
            const duration =
              typeof data.duration === "number" ? data.duration : 0;
            // The last report of a preview lands on the length itself and
            // leaves isPaused false. Treat that as stopped.
            const atEnd = duration > 5000 && positionMs >= duration - 30;
            const paused = data.isPaused === true || atEnd;
            const buffering = data.isBuffering === true;
            const reported = paused ? { ...data, isPaused: true } : data;

            // Hand the photos this reading, stamped with the time it arrived
            // so they can glide forward until Spotify speaks again.
            emitRef.current(
              reported,
              atEnd ? duration : positionMs,
              !paused && !buffering,
            );
            resumeAtSavedPosition(positionMs);

            if (!paused && !buffering && lastPosition != null && positionMs > lastPosition + 400) {
              heardPlaying = true;
            }

            if (atEnd) {
              window.clearTimeout(stallTimer);
              // The signup card replaces the controls. A new embed brings
              // the play button back, at the start of the clip.
              if (duration < PREVIEW_EMBED_MS) recover(0);
              return;
            }

            if (paused || buffering) {
              window.clearTimeout(stallTimer);
              lastPosition = positionMs;
              // Pausing a preview does the same thing: the play button is
              // gone, so build a new one parked where they stopped.
              if (
                data.isPaused === true &&
                heardPlaying &&
                duration > 5000 &&
                duration < PREVIEW_EMBED_MS
              ) {
                recover(positionMs);
              }
              return;
            }

            if (lastPosition !== positionMs) {
              lastPosition = positionMs;
              armStallTimer(data, positionMs);
            }
          });

          // Start once Spotify says the embed is ready. Calling play earlier
          // as well sends a second play, and the button can end up showing
          // pause while nothing is audible.
          controller.addListener("ready", () => {
            if (cancelled) return;
            if (startAtMs > 500) resumeAtSavedPosition();
            else if (autoplay) tryPlay(controller);
          });
          if (startAtMs > 500) resumeAtSavedPosition();
        },
      );
    }

    const spotifyWindow = spotifyGlobals();

    // Reuse the script if another song (or the /test page) already loaded it.
    if (spotifyWindow.__SPOTIFY_IFRAME_API__) {
      onApiReady(spotifyWindow.__SPOTIFY_IFRAME_API__);
    } else {
      spotifyWindow.onSpotifyIframeApiReady = onApiReady;

      const existing = document.querySelector(
        'script[src="https://open.spotify.com/embed/iframe-api/v1"]',
      );
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://open.spotify.com/embed/iframe-api/v1";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      window.clearTimeout(stallTimer);
      publish(null);
      destroyController(controllerRef.current);
      controllerRef.current = null;
      host.replaceChildren();
    };
  }, [spotifyId, startAtMs, autoplay]);

  // "Play again" on the end-of-preview panel. The embed stays; we just
  // send it back to the start of the clip.
  useEffect(() => {
    if (seenRestart.current === restartNonce) return;
    seenRestart.current = restartNonce;

    const controller = controllerRef.current;
    if (!controller) return;

    controller.seek(0);
    tryPlay(controller);

    const previous = playbackRef.current;
    const nextPlayback: PlaybackUpdate = {
      ...previous,
      position: 0,
      isPaused: false,
      isBuffering: false,
    };
    playbackRef.current = nextPlayback;
    emitRef.current(nextPlayback, 0, true);
  }, [restartNonce]);

  return (
    <div className="spotify-player">
      {/* Spotify injects its player here. */}
      <div className="spotify-embed">
        <div ref={hostRef} />
      </div>
    </div>
  );
}

const SPOTIFY_LOGIN_URL = "https://accounts.spotify.com/login";

/** Shown under the player while Spotify is only playing a preview. */
function PreviewLoginHint() {
  return (
    <p className="spotify-login-hint">
      Already have an account?{" "}
      <a href={SPOTIFY_LOGIN_URL} target="_blank" rel="noopener noreferrer">
        Login to spotify
      </a>.
    </p>
  );
}

function loadingMessage(selection: SearchHit): string {
  if (selection.type === "artist") {
    return "Finding their top song…";
  }
  return "Loading media…";
}

/**
 * A song choice is already a Deezer track id.
 * A musician choice needs one extra lookup: their most popular song.
 * Returns null when that musician has no top song.
 */
async function resolveDeezerId(
  selection: SearchHit,
  signal: AbortSignal,
): Promise<number | null> {
  if (selection.type === "song") return selection.id;

  const response = await fetch(`/api/artist-top/${selection.id}`, { signal });
  const body = await readJson<{ deezerId?: number }>(response);

  if (response.status === 404) return null;

  if (!response.ok || !body) {
    throw new Error("We couldn’t load this musician. Please try again.");
  }

  return typeof body.deezerId === "number" ? body.deezerId : null;
}

/**
 * Asks our server for the song package: title, artist, tempo, scenes, photos.
 * The player uses the Spotify id. The visualizer uses the scenes.
 */
async function fetchSongPackage(
  deezerId: number,
  signal: AbortSignal,
): Promise<SongPackage> {
  const response = await fetch(`/api/song/${deezerId}`, { signal });
  const body = await readJson<Partial<SongPackage>>(response);

  if (response.status === 404) {
    throw new Error("We couldn’t find that song. Try another search.");
  }

  if (!response.ok || !body) {
    throw new Error("We couldn’t load this song. Please try again.");
  }

  if (typeof body.deezerId !== "number" || !body.title || !body.artist) {
    throw new Error("We couldn’t load this song. Please try again.");
  }

  return {
    deezerId: body.deezerId,
    spotifyId: body.spotifyId ?? null,
    spotifyLookup:
      body.spotifyLookup === "failed" || body.spotifyLookup === "missing"
        ? body.spotifyLookup
        : undefined,
    title: body.title,
    artist: body.artist,
    artistUrl: body.artistUrl ?? "",
    albumCoverUrl: body.albumCoverUrl ?? "",
    durationMs: body.durationMs ?? 0,
    bpm: body.bpm ?? 120,
    ...(typeof body.previewStartMs === "number" && body.previewStartMs >= 0
      ? { previewStartMs: body.previewStartMs }
      : {}),
    lyricsType: body.lyricsType ?? "none",
    scenes: body.scenes ?? [],
    photosBusy: body.photosBusy === true,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Read a JSON body. Returns null if the server sent something that
 * isn't JSON, so the caller can show a friendly message instead.
 */
async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Our messages start with "We ". Anything else is replaced. */
function friendlyLoadMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("We ")) {
    return error.message;
  }
  return "We couldn’t load this song. Please try again.";
}

/**
 * The trailing ellipsis on a loading line is three dots that appear
 * one after another. Other notices stay as written.
 */
function ScreenNotice({ text }: { text: string }) {
  const animated = text.endsWith("…");
  const label = animated ? text.slice(0, -1) : text;

  return (
    <p className="screen-status" role="status">
      {label}
      {animated && (
        <span className="screen-status-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
    </p>
  );
}

function hasPhotos(song: SongPackage): boolean {
  return song.scenes.some((scene) => scene.photos.length > 0);
}

/**
 * Loading and error lines, centered on the page.
 * They are drawn on the document itself. The player slot slides in from
 * above, and a slide like that would carry a centered line off screen.
 */
function ScreenNotices({ notices }: { notices: string[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || notices.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[8] flex flex-col items-center justify-center gap-3 px-8 text-center">
      {notices.map((text) => (
        <ScreenNotice key={text} text={text} />
      ))}
    </div>,
    document.body,
  );
}

/**
 * Lines that sit in the center of the screen: loading, and the reasons
 * the pictures or the player could not start.
 */
function screenNotices(
  status: LoadStatus,
  message: string,
  song: SongPackage | null,
): string[] {
  if (status === "loading" || status === "error") return [message];
  if (status !== "ready" || !song) return [];

  const notices: string[] = [];
  if (!hasPhotos(song)) {
    notices.push(
      song.photosBusy
        ? "Photo lookup is busy. Wait a minute, then try this song again."
        : "We couldn’t load photos for this song. Please try again.",
    );
  }
  if (!song.spotifyId) {
    notices.push(
      song.spotifyLookup === "failed"
        ? "We couldn’t reach Spotify just now. Please try this song again."
        : "This song isn’t on Spotify, so it can’t play here. Try another one.",
    );
  }
  return notices;
}

/**
 * Spotify's reported length, or the previous one if this update
 * didn't include it. Seeking sometimes leaves the length out.
 */
function reportedDuration(
  data: PlaybackUpdate | null,
  previous: PlaybackSample | null,
): number | undefined {
  if (typeof data?.duration === "number" && data.duration > 0) {
    return data.duration;
  }
  if (
    typeof previous?.reportedDurationMs === "number" &&
    previous.reportedDurationMs > 0
  ) {
    return previous.reportedDurationMs;
  }
  return undefined;
}

function tryPlay(controller: EmbedController) {
  try {
    controller.play();
  } catch {
    // The browser blocked autoplay. The Play button still works.
  }
}

function destroyController(controller: EmbedController | null) {
  if (!controller) return;
  try {
    controller.destroy();
  } catch {
    // The player was already removed. Safe to ignore.
  }
}

function readPlayback(
  event: { data?: PlaybackUpdate } | PlaybackUpdate,
): PlaybackUpdate {
  // Spotify usually wraps the numbers in { data: { ... } }.
  if (event && typeof event === "object" && "data" in event && event.data) {
    return event.data;
  }
  return event as PlaybackUpdate;
}
