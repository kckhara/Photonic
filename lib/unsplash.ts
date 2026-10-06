/**
 * Unsplash photo search. This file runs on the server only.
 *
 * The access key (UNSPLASH_ACCESS_KEY in .env.local) is sent from here
 * and never included in the song package. A search is remembered for
 * 24 hours so repeat plays don't use up the Unsplash limit (50 requests
 * an hour on a demo app). Which photos are chosen is decided later, when
 * the song is built, so that choice is not cached.
 *
 * Each search asks for landscape photos with the stricter content filter.
 * The caller merges those with the Pexels results, then applies the same
 * blocklist, width check, and stock score. The average color comes from
 * the blur hash, which is the same kind of signal as a Pexels avg_color.
 * If Unsplash fails or is over its limit, the caller keeps going with
 * Pexels only.
 *
 * Image files are loaded straight from Unsplash's own addresses. We do
 * not copy them onto our server. The first time a photo is actually
 * shown, the browser asks /api/unsplash/download to ping that photo's
 * download endpoint. That ping is how Unsplash counts the use. It is
 * not the image itself.
 */

import { unstable_cache } from "next/cache";
import { unsplashReferralUrl } from "@/lib/unsplash-links";
import type { Photo } from "@/lib/types";

const ONE_DAY_SECONDS = 86400;
const RESULTS_PER_PAGE = 20;

type UnsplashUrls = {
  raw?: string;
  full?: string;
  regular?: string;
};

type UnsplashPhoto = {
  id?: string;
  description?: string | null;
  alt_description?: string | null;
  width?: number;
  height?: number;
  color?: string | null;
  // Compact stand-in for the picture. Its average color is the same kind
  // of signal Pexels sends as avg_color.
  blur_hash?: string | null;
  short_description?: string | null;
  urls?: UnsplashUrls;
  links?: {
    html?: string;
    download_location?: string;
  };
  user?: {
    id?: string | null;
    name?: string | null;
    links?: { html?: string };
  };
};

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
  errors?: string[];
};

export type UnsplashLookup = {
  photos: Photo[];
  /** True when Unsplash was not used. The caller should keep the Pexels photos. */
  skipped: boolean;
};

/** Unsplash answered 403 or 429, or rejected the key. One search can stop. */
class UnsplashUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsplashUnavailableError";
  }
}

let missingKeyLogged = false;

/**
 * One page of Unsplash photos for a picture-word.
 * On any failure, including the hourly limit, returns no photos and
 * skipped: true. It does not throw — the song still gets its Pexels photos.
 */
export async function searchUnsplash(
  query: string,
  page: number,
): Promise<UnsplashLookup> {
  const text = query.trim();
  if (!text) return { photos: [], skipped: false };

  if (!process.env.UNSPLASH_ACCESS_KEY?.trim()) {
    if (!missingKeyLogged) {
      missingKeyLogged = true;
      console.error(
        "Unsplash lookup skipped. Add UNSPLASH_ACCESS_KEY to .env.local. Continuing with Pexels.",
      );
    }
    return { photos: [], skipped: true };
  }

  try {
    const photos = await getUnsplashSearch(text, page);
    return { photos, skipped: false };
  } catch (error) {
    console.error("Unsplash lookup failed. Continuing with Pexels.", error);
    return { photos: [], skipped: true };
  }
}

// Same idea as the Pexels cache: remember the list for a day.
// The key stays in the request header, which Next.js will not store,
// so we store the short list of photos instead.
// A failure throws, and a thrown lookup is not kept — a rate limit
// must not freeze Unsplash out for the rest of the day.
// The blocklist is applied after this list is merged with Pexels,
// so editing lib/photo-blocklist.ts takes effect on the next song.
const getUnsplashSearch = unstable_cache(
  fetchUnsplashSearch,
  [
    "unsplash-search",
    "landscape",
    "content-filter-high",
    "per-page-20",
    // Cached photos need a width, a photographer id, and an average
    // color (read from the blur hash) for the stock score.
    "width-photographer-id-blurhash-average",
  ],
  { revalidate: ONE_DAY_SECONDS },
);

async function fetchUnsplashSearch(
  query: string,
  page: number,
): Promise<Photo[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();

  if (!key) {
    throw new UnsplashUnavailableError(
      "Missing UNSPLASH_ACCESS_KEY. Add it to .env.local and restart npm run dev.",
    );
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(RESULTS_PER_PAGE));
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");

  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${key}`,
      "Accept-Version": "v1",
    },
    // The wrapper above stores the photos. Don't also store this call,
    // because the header contains the key.
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new UnsplashUnavailableError(
      "Unsplash rejected the API key. Check UNSPLASH_ACCESS_KEY in .env.local.",
    );
  }

  if (response.status === 403 || response.status === 429) {
    throw new UnsplashUnavailableError(
      "Unsplash is over its limit. Photos will come from Pexels.",
    );
  }

  if (!response.ok) {
    throw new UnsplashUnavailableError(
      `Unsplash photo search failed (${response.status}).`,
    );
  }

  const body = (await response.json()) as UnsplashSearchResponse;

  if (body.errors?.length) {
    throw new UnsplashUnavailableError("Unsplash photo search failed.");
  }

  const photos: Photo[] = [];
  const seen = new Set<string>();

  for (const item of body.results ?? []) {
    const photo = toUnsplashPhoto(item);
    if (!photo || seen.has(photo.id)) continue;
    seen.add(photo.id);
    photos.push(photo);
  }

  return photos;
}

/**
 * Tell Unsplash a photo was used. Called the first time that photo
 * appears on screen. The address must be the download endpoint Unsplash
 * sent with the photo — we will not call any other host.
 */
export async function triggerUnsplashDownload(
  downloadLocation: string,
): Promise<void> {
  if (!isUnsplashDownloadLocation(downloadLocation)) return;

  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) {
    console.error(
      "Unsplash download not tracked. Add UNSPLASH_ACCESS_KEY to .env.local.",
    );
    return;
  }

  try {
    const response = await fetch(downloadLocation, {
      headers: {
        Authorization: `Client-ID ${key}`,
        "Accept-Version": "v1",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Unsplash download tracking failed", response.status);
    }
  } catch (error) {
    console.error("Unsplash download tracking failed", error);
  }
}

/** True only for Unsplash's own photo download endpoint. */
export function isUnsplashDownloadLocation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "api.unsplash.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      /^\/photos\/[A-Za-z0-9_-]+\/download$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * A display-sized image on Unsplash's CDN.
 * `raw` is their base address, including the ixid they use to count views.
 * Resizing keeps that parameter and still loads the file from Unsplash.
 */
function unsplashImageUrl(urls: UnsplashUrls | undefined): string {
  const raw = urls?.raw?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      url.searchParams.set("auto", "format");
      url.searchParams.set("fit", "max");
      url.searchParams.set("fm", "jpg");
      url.searchParams.set("q", "80");
      url.searchParams.set("w", "1920");
      return url.toString();
    } catch {
      return raw;
    }
  }

  return urls?.regular?.trim() || urls?.full?.trim() || "";
}

function toUnsplashPhoto(photo: UnsplashPhoto): Photo | null {
  if (!photo.id || !/^[A-Za-z0-9_-]+$/.test(photo.id)) return null;

  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  if (width > 0 && height > 0 && width < height) return null;

  const src = unsplashImageUrl(photo.urls);
  if (!src) return null;

  const alt = unsplashAlt(photo);

  const downloadLocation = photo.links?.download_location?.trim() || "";
  const userId = photo.user?.id?.trim() || "";

  return {
    id: `unsplash:${photo.id}`,
    provider: "unsplash",
    src,
    alt,
    avgColor:
      averageColorFromBlurHash(photo.blur_hash) || placeholderColor(photo.color),
    ...(photo.width && photo.width > 0 ? { width: photo.width } : {}),
    ...(userId ? { photographerId: `unsplash:${userId}` } : {}),
    photographer: photo.user?.name?.trim() || "Unknown photographer",
    photographerUrl: unsplashReferralUrl(photo.user?.links?.html || ""),
    pageUrl: unsplashReferralUrl(photo.links?.html || ""),
    pexelsUrl: "",
    ...(isUnsplashDownloadLocation(downloadLocation)
      ? { downloadLocation }
      : {}),
  };
}

/** Description text, without repeating the same sentence twice. */
function unsplashAlt(photo: UnsplashPhoto): string {
  const parts: string[] = [];

  for (const part of [
    photo.alt_description,
    photo.short_description,
    photo.description,
  ]) {
    const text = part?.trim();
    if (!text) continue;
    const already = parts.some(
      (existing) => existing.toLowerCase() === text.toLowerCase(),
    );
    if (already) continue;
    parts.push(text);
  }

  return parts.join(". ") || "Photo";
}

/**
 * Average sRGB color stored in a BlurHash, as a hex code.
 * Pexels scores brightness from avg_color. Unsplash's `color` is only a
 * swatch, so the stock score uses this average instead.
 * Returns "" when the hash is missing or not one we can read.
 */
function averageColorFromBlurHash(blurHash: string | null | undefined): string {
  const hash = blurHash?.trim() ?? "";
  if (hash.length < 6) return "";

  const value = decodeBase83(hash.slice(2, 6));
  if (value == null) return "";

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

const BLURHASH_DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decodeBase83(text: string): number | null {
  let value = 0;

  for (const character of text) {
    const digit = BLURHASH_DIGITS.indexOf(character);
    if (digit < 0) return null;
    value = value * 83 + digit;
  }

  return value;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function placeholderColor(color: string | null | undefined): string {
  const value = color?.trim() ?? "";
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#111111";
}
