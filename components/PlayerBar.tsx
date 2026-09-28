"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/lib/deezer";
import { estimatePositionMs } from "@/lib/tempo";
import type { PlaybackSample, SongPackage } from "@/lib/types";

// Spotify's embed needs about this much height to show the song.
// Our own buttons sit underneath, so the bar stays small.
const EMBED_HEIGHT = "152";

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
 * Sits under the search box after a song or musician is chosen.
 * Loads that song from our server, then plays it on Spotify.
 * Tells the page when the song package arrives, and where playback is,
 * so the photos can follow along.
 */
export function PlayerBar({
  selection,
  onSong,
  onPlayback,
  previewMode = false,
  onShowLoginPrompt,
  playerCommand = null,
}: {
  selection: SearchHit;
  onSong: (song: SongPackage | null) => void;
  onPlayback: (playback: PlaybackSample | null) => void;
  // True while Spotify is only playing a 30-second preview.
  previewMode?: boolean;
  // The "Log in for full songs" link in the button row.
  onShowLoginPrompt?: () => void;
  // Reload the embed, or send the preview back to the start.
  playerCommand?: PlayerCommand | null;
}) {
  // Kept in refs so a new render doesn't restart the song load.
  const onSongRef = useRef(onSong);
  const onPlaybackRef = useRef(onPlayback);

  useEffect(() => {
    onSongRef.current = onSong;
    onPlaybackRef.current = onPlayback;
  });
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [song, setSong] = useState<SongPackage | null>(null);
  const [message, setMessage] = useState(() => loadingMessage(selection));
  // A new generation throws away the Spotify embed and builds a fresh one,
  // so a login in another tab can take effect. startAtMs is where to resume.
  const [playerSlot, setPlayerSlot] = useState({ generation: 0, startAtMs: 0 });
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

  const heading = song
    ? `${song.title} by ${song.artist}`
    : selectionLabel(selection);

  return (
    <section className="mt-6 space-y-3" aria-label="Player">
      <p className="font-medium">{heading}</p>

      {status === "loading" && (
        <p className="text-sm opacity-70" role="status">
          {message}
        </p>
      )}

      {status === "error" && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}

      {status === "ready" && song && !hasPhotos(song) && (
        <p className="text-sm" role="status">
          We couldn’t load photos for this song. Please try again.
        </p>
      )}

      {status === "ready" && song && !song.spotifyId && (
        <p className="text-sm" role="status">
          This song isn’t on Spotify, so it can’t play here. Try another one.
        </p>
      )}

      {status === "ready" && song?.spotifyId && (
        <SpotifyPlayer
          key={playerSlot.generation}
          spotifyId={song.spotifyId}
          startAtMs={playerSlot.startAtMs}
          restartNonce={restartNonce}
          showLoginLink={previewMode}
          onShowLoginPrompt={onShowLoginPrompt}
          onPlayback={(sample) => onPlaybackRef.current(sample)}
        />
      )}
    </section>
  );
}

/**
 * The Spotify embed plus our Play/Pause and skip buttons.
 * Rendered only after we know the Spotify track id.
 */
function SpotifyPlayer({
  spotifyId,
  startAtMs,
  restartNonce,
  showLoginLink,
  onShowLoginPrompt,
  onPlayback,
}: {
  spotifyId: string;
  // 0 on a normal song start. After "Reload player", the moment to jump back to.
  startAtMs: number;
  restartNonce: number;
  showLoginLink: boolean;
  onShowLoginPrompt?: () => void;
  onPlayback: (playback: PlaybackSample | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const playbackRef = useRef<PlaybackUpdate | null>(null);
  // The last position we told the photos about, including pause and skip.
  const sampleRef = useRef<PlaybackSample | null>(null);
  const onPlaybackRef = useRef(onPlayback);
  // So "Play again" doesn't also run on the first render, or again
  // when "Reload player" builds a brand-new embed.
  const seenRestart = useRef(restartNonce);

  useEffect(() => {
    onPlaybackRef.current = onPlayback;
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

  const [playerReady, setPlayerReady] = useState(false);
  const [playback, setPlayback] = useState<PlaybackUpdate | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Spotify swaps this empty div for its iframe, so start clean every time.
    const element = document.createElement("div");
    host.replaceChildren(element);

    let cancelled = false;

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
          setPlayerReady(true);

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
            tryPlay(controller);
          }

          controller.addListener("playback_update", (event) => {
            // Ignore reports from a player we're already tearing down.
            if (cancelled) return;

            const data = readPlayback(event);
            playbackRef.current = data;
            setPlayback(data);
            const positionMs =
              typeof data.position === "number" ? data.position : 0;
            // Hand the photos this reading, stamped with the time it arrived
            // so they can glide forward until Spotify speaks again.
            emitRef.current(
              data,
              positionMs,
              data.isPaused === false && data.isBuffering !== true,
            );
            resumeAtSavedPosition(positionMs);
          });

          // Try to start as soon as the player exists, and again when Spotify
          // says the embed is ready. The click that picked the song is on our
          // page, and the player lives on Spotify's site, so some browsers
          // still wait for the Play button.
          controller.addListener("ready", () => {
            if (cancelled) return;
            if (startAtMs > 500) resumeAtSavedPosition();
            else tryPlay(controller);
          });
          if (startAtMs > 500) resumeAtSavedPosition();
          else tryPlay(controller);
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
      publish(null);
      destroyController(controllerRef.current);
      controllerRef.current = null;
      host.replaceChildren();
    };
  }, [spotifyId, startAtMs]);

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
    setPlayback(nextPlayback);
    emitRef.current(nextPlayback, 0, true);
  }, [restartNonce]);

  function onPlayPause() {
    const controller = controllerRef.current;
    if (!controller) return;

    const current = playbackRef.current;

    // isPaused is missing until the first update — treat that as "not started".
    // Freeze or resume the photos immediately. Spotify confirms a moment later.
    if (current?.isPaused === false) {
      controller.pause();
      noteTransport(false);
      return;
    }
    if (current?.isPaused) {
      controller.resume();
      noteTransport(true);
      return;
    }
    controller.play();
    noteTransport(true);
  }

  function onSeek(deltaSeconds: number) {
    // Skip from the smooth position, not the last once-a-second report,
    // so the photos jump to the same place as the music.
    const positionMs = Math.max(
      0,
      estimatePositionMs(sampleRef.current) + deltaSeconds * 1000,
    );
    controllerRef.current?.seek(positionMs / 1000);

    const previous = playbackRef.current;
    const nextPlayback: PlaybackUpdate = {
      ...previous,
      position: positionMs,
    };
    playbackRef.current = nextPlayback;
    setPlayback(nextPlayback);
    emit(nextPlayback, positionMs, sampleRef.current?.isPlaying ?? false);
  }

  function noteTransport(isPlaying: boolean) {
    const positionMs = estimatePositionMs(sampleRef.current);
    const previous = playbackRef.current;
    const nextPlayback: PlaybackUpdate = {
      ...previous,
      position: positionMs,
      isPaused: !isPlaying,
      isBuffering: false,
    };
    playbackRef.current = nextPlayback;
    setPlayback(nextPlayback);
    emit(nextPlayback, positionMs, isPlaying);
  }

  // False until Spotify tells us the song is actually playing.
  const isPlaying = playback?.isPaused === false;

  return (
    <div className="space-y-3">
      {/* Spotify injects its player here */}
      <div ref={hostRef} className="min-h-[152px] w-full" />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!playerReady}
          className="rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => onSeek(-10)}
          disabled={!playerReady}
          className="rounded border border-foreground/30 px-3 py-2 text-sm disabled:opacity-40"
        >
          −10s
        </button>
        <button
          type="button"
          onClick={() => onSeek(10)}
          disabled={!playerReady}
          className="rounded border border-foreground/30 px-3 py-2 text-sm disabled:opacity-40"
        >
          +10s
        </button>
        {showLoginLink && (
          <button
            type="button"
            onClick={onShowLoginPrompt}
            className="px-1 py-2 text-sm underline underline-offset-2"
          >
            Log in for full songs
          </button>
        )}
      </div>

      <p className="text-sm opacity-70">
        If the music doesn’t start, press Play. Some browsers wait for that
        extra click.
      </p>
    </div>
  );
}

function loadingMessage(selection: SearchHit): string {
  if (selection.type === "artist") {
    return "Finding their top song…";
  }
  return "Loading the song…";
}

function selectionLabel(selection: SearchHit): string {
  if (selection.type === "song") {
    return `${selection.title} by ${selection.artistName}`;
  }
  return selection.name;
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
    title: body.title,
    artist: body.artist,
    artistUrl: body.artistUrl ?? "",
    albumCoverUrl: body.albumCoverUrl ?? "",
    durationMs: body.durationMs ?? 0,
    bpm: body.bpm ?? 120,
    lyricsType: body.lyricsType ?? "none",
    scenes: body.scenes ?? [],
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

function hasPhotos(song: SongPackage): boolean {
  return song.scenes.some((scene) => scene.photos.length > 0);
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
