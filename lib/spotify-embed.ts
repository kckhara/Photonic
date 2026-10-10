import { isPhoneLayout } from "@/lib/phone";

/**
 * Phone browsers preload each Spotify embed while search results are open,
 * so the player can show one quickly. The tap that chooses a song does not
 * call play(). Spotify's play() starts a 30-second preview even when this
 * browser is logged into Premium. The play button inside the embed is what
 * starts the full song, and it can see the login.
 *
 * That same tap asks the browser to let the embed read Spotify's cookies.
 * A preload from before that grant is thrown away, and the visible player
 * waits for the grant before it builds a new embed.
 *
 * Browser-only. Imported from the search box and the player.
 */

const SCRIPT = "https://open.spotify.com/embed/iframe-api/v1";
const SPOTIFY_ORIGIN = "https://open.spotify.com";

// Resolved once a tap has asked for Spotify's cookies. The visible player
// waits on this before building its embed. Starts finished so a player
// that appears without a tap does not wait forever.
let cookieAccess: Promise<void> = Promise.resolve();

type StorageAccessDocument = Document & {
  requestStorageAccessFor?: (origin: string) => Promise<void>;
};

/**
 * Ask the browser, inside the tap that chose the song, to let an embed
 * from open.spotify.com read the Spotify login. Browsers that block
 * third-party cookies otherwise treat that embed as logged out.
 */
export function requestSpotifyCookieAccess(): void {
  const request = (document as StorageAccessDocument).requestStorageAccessFor;
  if (!request) return;
  cookieAccess = request.call(document, SPOTIFY_ORIGIN).then(
    () => undefined,
    () => undefined,
  );
}

/** Resolves when the latest cookie request has finished, or immediately. */
export function spotifyCookiesReady(): Promise<void> {
  return cookieAccess;
}

// Don't leave the visible player blank if a preload never finishes.
const WAIT_FOR_WARM_MS = 8_000;

export type SpotifyEmbedController = {
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  addListener: (
    event: string,
    handler: (event: unknown) => void,
  ) => void;
  removeListener: (event: string, handler: (event: unknown) => void) => void;
};

type IFrameAPI = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width?: string; height?: string },
    callback: (controller: SpotifyEmbedController) => void,
  ) => void;
};

type SpotifyGlobals = {
  onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
  __SPOTIFY_IFRAME_API__?: IFrameAPI;
  __spotifyIframeApiWaiters__?: Array<(api: IFrameAPI) => void>;
};

type Warm = {
  spotifyId: string;
  slot: HTMLDivElement;
  iframe: HTMLIFrameElement | null;
  controller: SpotifyEmbedController | null;
  ready: boolean;
  hosted: boolean;
  playSent: boolean;
  playSentAt: number;
  whenController: Promise<void>;
  settle: () => void;
};

const warms = new Map<string, Warm>();
let keepIds = new Set<string>();
let pool: HTMLDivElement | null = null;
let prepareGeneration = 0;

function spotifyGlobals(): SpotifyGlobals {
  return window as unknown as SpotifyGlobals;
}

export function loadSpotifyIframeApi(): Promise<IFrameAPI> {
  const spotifyWindow = spotifyGlobals();
  if (spotifyWindow.__SPOTIFY_IFRAME_API__) {
    return Promise.resolve(spotifyWindow.__SPOTIFY_IFRAME_API__);
  }

  return new Promise((resolve) => {
    const waiters = spotifyWindow.__spotifyIframeApiWaiters__ ?? [];
    waiters.push(resolve);
    spotifyWindow.__spotifyIframeApiWaiters__ = waiters;
    if (waiters.length > 1) return;

    const previous = spotifyWindow.onSpotifyIframeApiReady;
    spotifyWindow.onSpotifyIframeApiReady = (api) => {
      spotifyWindow.__SPOTIFY_IFRAME_API__ = api;
      previous?.(api);
      const pending = spotifyWindow.__spotifyIframeApiWaiters__ ?? [];
      spotifyWindow.__spotifyIframeApiWaiters__ = [];
      for (const waiter of pending) waiter(api);
    };

    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

/**
 * Look up Spotify ids for the open search results and preload them
 * on a phone. The map keys are "song:123" and "artist:456".
 */
export async function prepareMobilePlayback(
  songs: Array<{ id: number }>,
  artists: Array<{ id: number }>,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const generation = ++prepareGeneration;

  if (!isPhoneLayout()) return map;
  if (songs.length === 0 && artists.length === 0) {
    warmSpotifyTracks([]);
    return map;
  }

  const params = new URLSearchParams();
  if (songs.length > 0) {
    params.set("songs", songs.map((song) => song.id).join(","));
  }
  if (artists.length > 0) {
    params.set("artists", artists.map((artist) => artist.id).join(","));
  }

  try {
    const response = await fetch(`/api/playback-ids?${params}`, { signal });
    if (!response.ok || signal.aborted || generation !== prepareGeneration) {
      return map;
    }

    const body = (await response.json()) as {
      songs?: Record<string, string | null>;
      artists?: Record<string, string | null>;
    };
    const spotifyIds: string[] = [];
    collect(body.songs, "song", map, spotifyIds);
    collect(body.artists, "artist", map, spotifyIds);

    if (signal.aborted || generation !== prepareGeneration) return map;
    warmSpotifyTracks(spotifyIds);
  } catch {
    // The tap can still use the player once the song package arrives.
  }

  return map;
}

function collect(
  ids: Record<string, string | null> | undefined,
  type: "song" | "artist",
  map: Map<string, string>,
  spotifyIds: string[],
) {
  if (!ids) return;
  for (const [deezerId, spotifyId] of Object.entries(ids)) {
    if (!spotifyId) continue;
    map.set(`${type}:${deezerId}`, spotifyId);
    spotifyIds.push(spotifyId);
  }
}

export function hasWarmedSpotify(spotifyId: string): boolean {
  return warms.has(spotifyId);
}

export function warmedSpotifyIsReady(spotifyId: string): boolean {
  return warms.get(spotifyId)?.ready === true;
}

export function waitForWarmedSpotify(spotifyId: string): Promise<boolean> {
  const warm = warms.get(spotifyId);
  if (!warm) return Promise.resolve(false);

  return Promise.race([
    warm.whenController.then(
      () => warms.get(spotifyId) === warm && Boolean(warm.controller && warm.iframe),
    ),
    wait(WAIT_FOR_WARM_MS).then(() => false),
  ]);
}

/** Move the preloaded iframe into the visible player. */
export function claimWarmedSpotify(
  spotifyId: string,
  host: HTMLElement,
): SpotifyEmbedController | null {
  const warm = warms.get(spotifyId);
  if (!warm?.controller || !warm.iframe) return null;
  host.replaceChildren(warm.iframe);
  warm.hosted = true;
  return warm.controller;
}

/** Drop a preload that the visible player is replacing, so it can't start a second copy. */
export function abandonWarmedSpotify(spotifyId: string) {
  destroyWarm(spotifyId);
}

/** Put a preloaded iframe back, or drop it if that search result is gone. */
export function releaseWarmedSpotify(spotifyId: string) {
  const warm = warms.get(spotifyId);
  if (!warm) return;

  warm.hosted = false;
  const justPlayed =
    warm.playSentAt > 0 && performance.now() - warm.playSentAt < 1200;
  if (!justPlayed) {
    try {
      warm.controller?.pause();
    } catch {
      // The embed was already removed.
    }
  }

  if (!keepIds.has(spotifyId)) {
    destroyWarm(spotifyId);
    return;
  }

  if (warm.iframe && warm.iframe.parentElement !== warm.slot) {
    warm.slot.appendChild(warm.iframe);
  }
}

function warmSpotifyTracks(ids: string[]) {
  const nextKeep = new Set(ids);
  keepIds = nextKeep;

  for (const id of warms.keys()) {
    if (!nextKeep.has(id) && !warms.get(id)?.hosted) destroyWarm(id);
  }

  for (const id of nextKeep) ensureWarm(id);
}

function ensureWarm(spotifyId: string) {
  if (warms.has(spotifyId)) return;

  const slot = document.createElement("div");
  slot.className = "spotify-warm-slot";
  const marker = document.createElement("div");
  slot.appendChild(marker);
  ensurePool().appendChild(slot);

  let settle = () => {};
  const whenController = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const warm: Warm = {
    spotifyId,
    slot,
    iframe: null,
    controller: null,
    ready: false,
    hosted: false,
    playSent: false,
    playSentAt: 0,
    whenController,
    settle,
  };
  warms.set(spotifyId, warm);

  void loadSpotifyIframeApi()
    .then((api) => {
      if (warms.get(spotifyId) !== warm || !slot.isConnected) {
        warm.settle();
        return;
      }

      api.createController(
        marker,
        {
          uri: `spotify:track:${spotifyId}`,
          width: "100%",
          height: "152",
        },
        (controller) => {
          if (warms.get(spotifyId) !== warm) {
            destroyController(controller);
            warm.settle();
            return;
          }

          warm.controller = controller;
          warm.iframe = slot.querySelector("iframe");
          controller.addListener("ready", () => {
            warm.ready = true;
          });
          warm.settle();
        },
      );
    })
    .catch(() => {
      warm.settle();
    });
}

function ensurePool(): HTMLDivElement {
  if (pool) return pool;
  const element = document.createElement("div");
  element.className = "spotify-warm-pool";
  element.setAttribute("aria-hidden", "true");
  document.body.appendChild(element);
  pool = element;
  return element;
}

function destroyWarm(spotifyId: string) {
  const warm = warms.get(spotifyId);
  if (!warm) return;
  warms.delete(spotifyId);
  warm.settle();
  destroyController(warm.controller);
  warm.slot.remove();
}

function destroyController(controller: SpotifyEmbedController | null) {
  if (!controller) return;
  try {
    controller.destroy();
  } catch {
    // Already removed.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
