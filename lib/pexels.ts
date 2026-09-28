/**
 * Pexels photo search. This file runs on the server only.
 *
 * The API key (PEXELS_API_KEY in .env.local) is sent from here and never
 * included in the song package. Each scene gets a new photo every time the
 * picture is supposed to change, so a long line does not replay the same few.
 * Results of a search are remembered for 24 hours so repeat plays don't
 * use up the Pexels limit (200 requests an hour). Which photos are chosen
 * is decided when the song is built, so that choice is not cached.
 *
 * For each scene:
 * - Add the next style word from lib/style-words.ts
 *   ("wonder" becomes "wonder moody", then the next scene gets "dusk", and so on).
 * - Ask for 20 landscape photos and skip any whose description is on the blocklist.
 * - Skip any photo already chosen earlier in this same song.
 * - Pick enough of the remaining photos, at random, to last the whole scene.
 * - If that search doesn't have enough, search the word alone and keep going.
 * - If that is also empty, use general (curated) photos that this song hasn't used.
 *
 * Videos (Phase 9B) use the same picture-word and the same API key.
 * Each scene gets one wide clip. If Pexels has none, that scene keeps
 * its photos. Video searches are remembered for 24 hours too, because
 * photos and videos share one hourly limit.
 */

import { unstable_cache } from "next/cache";
import { PHOTO_BLOCKLIST, altIsBlocked } from "@/lib/photo-blocklist";
import { styleWordAt } from "@/lib/style-words";
import { photoSlotCount } from "@/lib/tempo";
import type { Photo, Scene, VideoClip } from "@/lib/types";

const ONE_DAY_SECONDS = 86400;
const RESULTS_PER_PAGE = 20;
const CURATED_PHOTO_COUNT = 20;
const CURATED_PAGES = 5;

type PexelsPhoto = {
  id?: number;
  url?: string;
  alt?: string;
  avg_color?: string;
  photographer?: string;
  photographer_url?: string;
  src?: { large2x?: string };
};

type PexelsResponse = {
  photos?: PexelsPhoto[];
  error?: string;
};

/** Which search the photos actually came from. */
export type PhotoSource = "style" | "keyword" | "curated";

export type ScenePhotoChoice = {
  photos: Photo[];
  styleWord: string;
  /** The words sent to Pexels. The bare keyword when the style search fell short. */
  query: string;
  source: PhotoSource;
};

/**
 * Fill each scene with photos.
 * Scenes are handled in order so a photo used by an earlier scene
 * is not offered to a later one. bpm decides how many photos a scene
 * needs: one for every time the picture will change.
 */
export async function attachPhotos(
  scenes: Scene[],
  bpm: number,
): Promise<Scene[]> {
  const usedIds = new Set<number>();
  // The title card is not a picture-word, so it doesn't take a style word.
  const lyricScenes = scenes.filter((scene) => !scene.titleCard);

  // Load the style searches together. Choosing photos stays in order.
  const styleQueries = lyricScenes
    .map((scene, index) =>
      scene.keyword.trim()
        ? styleQuery(scene.keyword, styleWordAt(index))
        : "",
    )
    .filter((query) => query.length > 0);
  await Promise.all(
    [...new Set(styleQueries)].map((query) => getFilteredSearch(query, 1)),
  );

  const filled: Scene[] = [];
  let lyricIndex = 0;

  for (const scene of scenes) {
    if (scene.titleCard) {
      filled.push({ ...scene, photos: [] });
      continue;
    }

    const needed = photoSlotCount(scene.startMs, scene.endMs, bpm);
    const choice = await chooseScenePhotos(
      scene.keyword,
      lyricIndex,
      usedIds,
      needed,
    );
    lyricIndex += 1;
    for (const photo of choice.photos) usedIds.add(photo.id);
    filled.push({ ...scene, photos: choice.photos });
  }

  return filled;
}

/**
 * Photos for one scene.
 * usedIds is the set of photo ids already chosen earlier in this song.
 * This function does not add to that set; the caller does.
 * needed is how many photos the scene will show. It won't ask for the
 * same photo twice.
 */
export async function chooseScenePhotos(
  keyword: string,
  sceneIndex: number,
  usedIds: Set<number>,
  needed = 3,
): Promise<ScenePhotoChoice> {
  const styleWord = styleWordAt(sceneIndex);
  const count = Math.max(1, needed);
  const styled = styleQuery(keyword, styleWord);

  if (keyword.trim()) {
    const fromStyle = unused(await getFilteredSearch(styled, 1), usedIds);

    if (fromStyle.length >= count) {
      return {
        photos: pickRandom(fromStyle, count),
        styleWord,
        query: styled,
        source: "style",
      };
    }

    // Not enough new photos. Add the word-only search, then a second
    // page of each, until this scene can run without repeating.
    const pool = [...fromStyle];
    addNew(pool, unused(await getFilteredSearch(keyword, 1), usedIds));

    if (pool.length < count) {
      addNew(pool, unused(await getFilteredSearch(styled, 2), usedIds));
      addNew(pool, unused(await getFilteredSearch(keyword, 2), usedIds));
    }

    if (pool.length > 0) {
      const usedBareWord = pool.length > fromStyle.length;
      return {
        photos: pickRandom(pool, count),
        styleWord,
        query: usedBareWord ? keyword : styled,
        source: usedBareWord ? "keyword" : "style",
      };
    }
  }

  const curated: Photo[] = [];
  for (let page = 1; page <= CURATED_PAGES && curated.length < count; page += 1) {
    addNew(curated, unused(await getCuratedPage(page), usedIds));
  }

  return {
    photos: pickRandom(curated, count),
    styleWord,
    query: keyword,
    source: "curated",
  };
}

function styleQuery(keyword: string, styleWord: string): string {
  return `${keyword.trim()} ${styleWord}`.trim();
}

// The blocklist is part of the cache name. Editing lib/photo-blocklist.ts
// starts a fresh lookup instead of reusing yesterday's photos.
// The key sits in the Authorization header, so Next.js will not keep the
// raw request. We remember the filtered list itself for a day instead.
const getFilteredSearch = unstable_cache(
  fetchFilteredSearch,
  ["pexels-search-filtered-pages", PHOTO_BLOCKLIST.join("|")],
  { revalidate: ONE_DAY_SECONDS },
);

const getCuratedPage = unstable_cache(
  fetchCuratedPage,
  ["pexels-curated-page"],
  { revalidate: ONE_DAY_SECONDS },
);

/** Up to 20 landscape photos whose descriptions are not on the blocklist. */
async function fetchFilteredSearch(
  query: string,
  page: number,
): Promise<Photo[]> {
  const photos = await pexelsGet("search", {
    query,
    per_page: String(RESULTS_PER_PAGE),
    orientation: "landscape",
    page: String(page),
  });

  const seen = new Set<number>();
  const kept: Photo[] = [];

  for (const photo of photos) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    if (altIsBlocked(photo.alt, query)) continue;
    kept.push(photo);
  }

  return kept;
}

async function fetchCuratedPage(page: number): Promise<Photo[]> {
  const photos = await pexelsGet("curated", {
    per_page: String(CURATED_PHOTO_COUNT),
    page: String(page),
  });
  return photos.slice(0, CURATED_PHOTO_COUNT);
}

function unused(photos: Photo[], usedIds: Set<number>): Photo[] {
  return photos.filter((photo) => !usedIds.has(photo.id));
}

/** Add photos that are not already in the list. */
function addNew(pool: Photo[], photos: Photo[]) {
  const seen = new Set(pool.map((photo) => photo.id));
  for (const photo of photos) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    pool.push(photo);
  }
}

/** Shuffle a copy, then keep up to `count` photos. */
function pickRandom(photos: Photo[], count: number): Photo[] {
  const copy = [...photos];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = copy[i];
    copy[i] = copy[j];
    copy[j] = current;
  }

  return copy.slice(0, count);
}

async function pexelsGet(
  path: string,
  params: Record<string, string>,
): Promise<Photo[]> {
  const key = process.env.PEXELS_API_KEY;

  if (!key) {
    throw new Error(
      "Missing PEXELS_API_KEY. Add it to .env.local and restart npm run dev.",
    );
  }

  const url = new URL(`https://api.pexels.com/v1/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    headers: {
      // Pexels expects the raw key here, not "Bearer".
      Authorization: key,
    },
    // The wrapper above stores the photos. Don't also store this call,
    // because the header contains the key.
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Pexels rejected the API key. Check PEXELS_API_KEY in .env.local.",
    );
  }

  if (response.status === 429) {
    throw new Error(
      "Pexels is busy right now (too many photo lookups). Wait a minute and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(`Pexels photo search failed (${response.status}).`);
  }

  const body = (await response.json()) as PexelsResponse;

  if (body.error) {
    throw new Error("Pexels photo search failed.");
  }

  return (body.photos ?? [])
    .map(toPhoto)
    .filter((photo) => photo !== null);
}

// --- Videos (Phase 9B) ---------------------------------------------------

const VIDEO_RESULTS = 15;
// Wide enough to fill a laptop screen, small enough that a slow
// connection can still keep up. See the plan, section 5.7.
const PREFERRED_MIN_WIDTH = 1280;
const PREFERRED_MAX_WIDTH = 1920;

type PexelsVideoFile = {
  quality?: string | null;
  file_type?: string | null;
  width?: number | null;
  height?: number | null;
  link?: string | null;
};

type PexelsVideo = {
  id?: number;
  url?: string;
  image?: string;
  duration?: number;
  user?: { name?: string; url?: string };
  video_files?: PexelsVideoFile[];
};

type PexelsVideoResponse = {
  videos?: PexelsVideo[];
  error?: string;
};

/**
 * Give each scene one landscape clip, searched with that scene's picture-word.
 * Scenes are handled in order. A clip already used earlier in the song
 * is skipped, so the same footage doesn't come back for a different word.
 * A scene with no word (the title card, or curated photos) is left as photos.
 * If a search fails, that word keeps its photos — the song still plays.
 */
export async function attachVideos(scenes: Scene[]): Promise<Scene[]> {
  const queries = [
    ...new Set(
      scenes
        .filter((scene) => !scene.titleCard && scene.keyword.trim())
        .map((scene) => scene.keyword.trim()),
    ),
  ];

  await Promise.all(queries.map((query) => clipsForKeyword(query)));

  const usedIds = new Set<number>();
  const filled: Scene[] = [];

  for (const scene of scenes) {
    const keyword = scene.keyword.trim();
    if (scene.titleCard || !keyword) {
      filled.push({ ...scene, video: null });
      continue;
    }

    const clips = await clipsForKeyword(keyword);
    const clip = clips.find((item) => !usedIds.has(item.id)) ?? null;
    if (clip) usedIds.add(clip.id);
    filled.push({ ...scene, video: clip });
  }

  return filled;
}

/**
 * Landscape clips for one picture-word. Empty if Pexels has none,
 * or if this one search failed (the photos for that word still work).
 */
async function clipsForKeyword(query: string): Promise<VideoClip[]> {
  try {
    return await getLandscapeVideos(query);
  } catch (error) {
    console.error("Video lookup failed", query, error);
    return [];
  }
}

// Same idea as the photo cache: remember the chosen files for a day.
// The key stays in the request header, which Next.js will not store,
// so we store the short list of clips instead.
const getLandscapeVideos = unstable_cache(
  fetchLandscapeVideos,
  ["pexels-videos-landscape"],
  { revalidate: ONE_DAY_SECONDS },
);

async function fetchLandscapeVideos(query: string): Promise<VideoClip[]> {
  const key = process.env.PEXELS_API_KEY;

  if (!key) {
    throw new Error(
      "Missing PEXELS_API_KEY. Add it to .env.local and restart npm run dev.",
    );
  }

  // Video search has no "/v1/" in the path. Photo search does.
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(VIDEO_RESULTS));
  url.searchParams.set("orientation", "landscape");

  const response = await fetch(url, {
    headers: { Authorization: key },
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Pexels rejected the API key. Check PEXELS_API_KEY in .env.local.",
    );
  }

  if (response.status === 429) {
    throw new Error(
      "Pexels is busy right now (too many video lookups). Wait a minute and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(`Pexels video search failed (${response.status}).`);
  }

  const body = (await response.json()) as PexelsVideoResponse;

  if (body.error) {
    throw new Error("Pexels video search failed.");
  }

  const clips: VideoClip[] = [];
  const seen = new Set<number>();

  for (const video of body.videos ?? []) {
    const clip = toClip(video);
    if (!clip || seen.has(clip.id)) continue;
    seen.add(clip.id);
    clips.push(clip);
  }

  return clips;
}

/**
 * Turn one Pexels video into the single file we might play.
 * Prefers a wide HD file around 1280–1920 pixels across.
 * If none is that size, uses the smallest wide file.
 * Portrait files are skipped. Returns null when nothing qualifies.
 */
function toClip(video: PexelsVideo): VideoClip | null {
  if (typeof video.id !== "number") return null;
  if (typeof video.duration !== "number" || !(video.duration > 0)) return null;

  const file = pickLandscapeFile(video.video_files ?? []);
  if (!file?.link || !file.width || !file.height) return null;

  return {
    id: video.id,
    src: file.link,
    poster: video.image?.trim() || "",
    width: file.width,
    height: file.height,
    durationMs: Math.round(video.duration * 1000),
    videographer: video.user?.name?.trim() || "Unknown videographer",
    videographerUrl: video.user?.url?.trim() || "",
    pexelsUrl: video.url?.trim() || "",
  };
}

function pickLandscapeFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const landscape = files.filter(isLandscapeMp4);
  if (landscape.length === 0) return null;

  const preferred = landscape.filter((file) => {
    const width = file.width ?? 0;
    return (
      file.quality?.toLowerCase() === "hd" &&
      width >= PREFERRED_MIN_WIDTH &&
      width <= PREFERRED_MAX_WIDTH
    );
  });

  const pool = preferred.length > 0 ? preferred : landscape;
  // Smallest file that still qualifies. Easier on a slow connection.
  return [...pool].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
}

function isLandscapeMp4(file: PexelsVideoFile): boolean {
  const width = file.width ?? 0;
  const height = file.height ?? 0;
  if (!file.link || !(width > 0) || !(height > 0) || width < height) {
    return false;
  }

  // Skip streaming playlists. The browser can play an mp4 directly,
  // and we are not adding a streaming library.
  const type = file.file_type?.toLowerCase() ?? "";
  if (type === "video/mp4") return true;
  if (file.quality?.toLowerCase() === "hls") return false;
  return file.link.toLowerCase().includes(".mp4");
}

function toPhoto(photo: PexelsPhoto): Photo | null {
  if (typeof photo.id !== "number" || !photo.src?.large2x) return null;

  return {
    id: photo.id,
    src: photo.src.large2x,
    alt: photo.alt?.trim() || "Photo",
    avgColor: photo.avg_color || "#111111",
    photographer: photo.photographer || "Unknown photographer",
    photographerUrl: photo.photographer_url || "",
    pexelsUrl: photo.url || "",
  };
}
