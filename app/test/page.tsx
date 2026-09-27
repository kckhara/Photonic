"use client";

import { useEffect, useRef, useState } from "react";

// Hard-coded for Phase 1 only — The Weeknd, "Blinding Lights"
const TEST_SPOTIFY_TRACK_ID = "0VjIjW4GlUZAMYd2vXMi3b";
const TEST_ISRC = "USUG11904206";

// Shape of Spotify's playback_update event (from their iFrame API docs)
type PlaybackUpdate = {
  playingURI?: string;
  isPaused?: boolean;
  isBuffering?: boolean;
  duration?: number;
  position?: number;
};

type EmbedController = {
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
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

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
    // We store the API here so React's double-render in development still works.
    __SPOTIFY_IFRAME_API__?: IFrameAPI;
  }
}

export default function TestPage() {
  const playerHostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const playbackRef = useRef<PlaybackUpdate | null>(null);

  const [playerReady, setPlayerReady] = useState(false);
  const [playback, setPlayback] = useState<PlaybackUpdate | null>(null);
  const [isrcResult, setIsrcResult] = useState<string>("Looking up ISRC…");

  // 1) Load Spotify's iFrame API and create the player for our hard-coded track.
  useEffect(() => {
    const host = playerHostRef.current;
    if (!host) return;

    // Spotify replaces this element with an iframe, so we always start with a fresh empty div.
    const element = document.createElement("div");
    host.replaceChildren(element);

    let cancelled = false;

    function onApiReady(IFrameAPI: IFrameAPI) {
      window.__SPOTIFY_IFRAME_API__ = IFrameAPI;
      if (cancelled) return;

      IFrameAPI.createController(
        element,
        {
          uri: `spotify:track:${TEST_SPOTIFY_TRACK_ID}`,
          width: "100%",
          height: "152",
        },
        (controller) => {
          if (cancelled) return;
          controllerRef.current = controller;
          setPlayerReady(true);

          controller.addListener("playback_update", (event) => {
            // Spotify usually sends { data: { position, duration, ... } }
            const data =
              event && typeof event === "object" && "data" in event && event.data
                ? event.data
                : (event as PlaybackUpdate);

            playbackRef.current = data;
            setPlayback(data);
          });
        },
      );
    }

    // If the script already loaded (dev refresh / Strict Mode), reuse it.
    if (window.__SPOTIFY_IFRAME_API__) {
      onApiReady(window.__SPOTIFY_IFRAME_API__);
    } else {
      window.onSpotifyIframeApiReady = onApiReady;

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
    };
  }, []);

  // 2) Ask our server to turn the hard-coded ISRC into a Spotify track ID.
  useEffect(() => {
    async function lookupIsrc() {
      try {
        const response = await fetch(
          `/api/spotify/isrc?isrc=${encodeURIComponent(TEST_ISRC)}`,
        );
        const data = (await response.json()) as {
          spotifyId?: string | null;
          error?: string;
        };

        if (!response.ok) {
          setIsrcResult(data.error ?? "ISRC lookup failed.");
          return;
        }

        if (!data.spotifyId) {
          setIsrcResult(`No Spotify track found for ISRC ${TEST_ISRC}.`);
          return;
        }

        setIsrcResult(
          `ISRC ${TEST_ISRC} → Spotify track ID ${data.spotifyId}`,
        );
      } catch {
        setIsrcResult("Could not reach the ISRC lookup route.");
      }
    }

    lookupIsrc();
  }, []);

  function handlePlay() {
    const controller = controllerRef.current;
    if (!controller) return;

    // After a pause, resume() continues. First start uses play().
    if (playbackRef.current?.isPaused) {
      controller.resume();
    } else {
      controller.play();
    }
  }

  function handlePause() {
    controllerRef.current?.pause();
  }

  function handleSeek(deltaSeconds: number) {
    const positionMs = playbackRef.current?.position ?? 0;
    const nextSeconds = Math.max(0, positionMs / 1000 + deltaSeconds);
    controllerRef.current?.seek(nextSeconds);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-10 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-500">Phase 1 test page</p>
        <h1 className="mt-1 text-2xl font-semibold">Spotify checks</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Temporary page at <code>/test</code>. We will remove it before launch.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">1. Embedded player</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Hard-coded track: The Weeknd — Blinding Lights (
          <code>{TEST_SPOTIFY_TRACK_ID}</code>)
        </p>

        {/* Spotify injects its iframe here */}
        <div ref={playerHostRef} className="min-h-[152px] w-full" />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePlay}
            disabled={!playerReady}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Play
          </button>
          <button
            type="button"
            onClick={handlePause}
            disabled={!playerReady}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => handleSeek(-10)}
            disabled={!playerReady}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            −10s
          </button>
          <button
            type="button"
            onClick={() => handleSeek(10)}
            disabled={!playerReady}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            +10s
          </button>
        </div>

        <div className="rounded-md bg-zinc-100 p-4 font-mono text-sm dark:bg-zinc-900">
          <p className="mb-2 font-sans font-medium text-zinc-700 dark:text-zinc-300">
            Live playback_update
          </p>
          {playback ? (
            <ul className="space-y-1">
              <li>position: {playback.position ?? "—"} ms</li>
              <li>duration: {playback.duration ?? "—"} ms</li>
              <li>isPaused: {String(playback.isPaused)}</li>
              <li>isBuffering: {String(playback.isBuffering)}</li>
            </ul>
          ) : (
            <p>Waiting for the first update (press Play)…</p>
          )}
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Note whether Play starts the song without clicking inside the Spotify
          player. That tells us how “immediate” play can be later.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">2. ISRC → Spotify ID</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The page asks our server for this hard-coded ISRC. Keys stay in{" "}
          <code>.env.local</code>.
        </p>
        <p className="rounded-md bg-zinc-100 p-4 font-mono text-sm dark:bg-zinc-900">
          {isrcResult}
        </p>
      </section>
    </main>
  );
}
