/**
 * Pexels photo search. This file runs on the server only.
 *
 * The API key (PEXELS_API_KEY in .env.local) is sent from here and never
 * included in the song package. Each word gets 3 landscape photos.
 * The same word later in the song reuses those photos.
 * Results are remembered for 24 hours so repeat plays don't use up the
 * Pexels limit (200 requests an hour).
 */

import { unstable_cache } from "next/cache";
import type { Photo, Scene } from "@/lib/types";

const ONE_DAY_SECONDS = 86400;
const PHOTOS_PER_KEYWORD = 3;
const CURATED_PHOTO_COUNT = 20;

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

/**
 * Fill each scene with photos for its word.
 * Asks Pexels once per different word, then copies that set onto every
 * scene that uses the word.
 */
export async function attachPhotos(scenes: Scene[]): Promise<Scene[]> {
  const keywords = [...new Set(scenes.map((scene) => scene.keyword))];
  const pairs = await Promise.all(
    keywords.map(async (keyword) => {
      const photos = await getPhotosForKeyword(keyword);
      return [keyword, photos] as const;
    }),
  );
  const byKeyword = new Map(pairs);

  return scenes.map((scene) => ({
    ...scene,
    photos: byKeyword.get(scene.keyword) ?? [],
  }));
}

// The key sits in the Authorization header, so Next.js will not keep the
// raw request. We remember the photo list itself for a day instead.
export const getPhotosForKeyword = unstable_cache(
  fetchPhotosForKeyword,
  ["pexels-keyword"],
  { revalidate: ONE_DAY_SECONDS },
);

export const getCuratedPhotos = unstable_cache(
  fetchCuratedPhotos,
  ["pexels-curated"],
  { revalidate: ONE_DAY_SECONDS },
);

async function fetchPhotosForKeyword(keyword: string): Promise<Photo[]> {
  const photos = await pexelsGet("search", {
    query: keyword,
    per_page: String(PHOTOS_PER_KEYWORD),
    orientation: "landscape",
  });
  return photos.slice(0, PHOTOS_PER_KEYWORD);
}

async function fetchCuratedPhotos(): Promise<Photo[]> {
  const photos = await pexelsGet("curated", {
    per_page: String(CURATED_PHOTO_COUNT),
  });
  return photos.slice(0, CURATED_PHOTO_COUNT);
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
