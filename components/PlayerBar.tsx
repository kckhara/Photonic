"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/lib/deezer";
import type { SongPackage } from "@/lib/types";

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

/**
 * Sits under the search box after a song or musician is chosen.
 * Loads that song from our server, then plays it on Spotify.
 */
export function PlayerBar({ selection }: { selection: SearchHit }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [song, setSong] = useState<SongPackage | null>(null);
  const [message, setMessage] = useState(() => loadingMessage(selection));

  // Each new choice starts a fresh load. If the person picks something else
  // before this finishes, we cancel so an old result can't overwrite the new one.
  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setSong(null);
      setMessage(loadingMessage(selection));

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
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "We couldn’t load this song. Please try again.",
        );
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

      {status === "ready" && song && !song.spotifyId && (
        <p className="text-sm" role="status">
          This song isn’t on Spotify, so it can’t play here. Try another one.
        </p>
      )}

      {status === "ready" && song?.spotifyId && (
        <SpotifyPlayer spotifyId={song.spotifyId} />
      )}
    </section>
  );
}

/**
 * The Spotify embed plus our Play/Pause and skip buttons.
 * Rendered only after we know the Spotify track id.
 */
function SpotifyPlayer({ spotifyId }: { spotifyId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const playbackRef = useRef<PlaybackUpdate | null>(null);

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

          controller.addListener("playback_update", (event) => {
            const data = readPlayback(event);
            playbackRef.current = data;
            setPlayback(data);
          });

          // Try to start as soon as the player exists, and again when Spotify
          // says the embed is ready. The click that picked the song is on our
          // page, and the player lives on Spotify's site, so some browsers
          // still wait for the Play button.
          controller.addListener("ready", () => {
            if (!cancelled) tryPlay(controller);
          });
          tryPlay(controller);
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
      destroyController(controllerRef.current);
      controllerRef.current = null;
      host.replaceChildren();
    };
  }, [spotifyId]);

  function onPlayPause() {
    const controller = controllerRef.current;
    if (!controller) return;

    const current = playbackRef.current;

    // isPaused is missing until the first update — treat that as "not started".
    if (current?.isPaused === false) {
      controller.pause();
      return;
    }
    if (current?.isPaused) {
      controller.resume();
      return;
    }
    controller.play();
  }

  function onSeek(deltaSeconds: number) {
    const positionMs = playbackRef.current?.position ?? 0;
    const nextSeconds = Math.max(0, positionMs / 1000 + deltaSeconds);
    controllerRef.current?.seek(nextSeconds);
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
  const body = (await response.json()) as {
    deezerId?: number;
    error?: string;
  };

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      body.error || "We couldn’t load this musician. Please try again.",
    );
  }

  return typeof body.deezerId === "number" ? body.deezerId : null;
}

/** Asks our server for the song package (title, artist, Spotify id, and so on). */
async function fetchSongPackage(
  deezerId: number,
  signal: AbortSignal,
): Promise<SongPackage> {
  const response = await fetch(`/api/song/${deezerId}`, { signal });
  const body = (await response.json()) as Partial<SongPackage> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      body.error || "We couldn’t load this song. Please try again.",
    );
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
    durationMs: body.durationMs ?? 0,
    bpm: body.bpm ?? 120,
    lyricsType: body.lyricsType ?? "none",
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
