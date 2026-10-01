/**
 * Credit links for Unsplash photos.
 *
 * This file has no API key. The browser can import it. The key stays in
 * lib/unsplash.ts, which only runs on the server.
 *
 * Unsplash asks every credit link to carry
 * ?utm_source=[app name]&utm_medium=referral
 */

export const UNSPLASH_APP_NAME = "lyric-visualizer";

/** The Unsplash homepage, with the referral parameters their guidelines require. */
export function unsplashHomeUrl(): string {
  return unsplashReferralUrl("https://unsplash.com/");
}

/**
 * Add Unsplash's referral parameters to a photographer profile or photo page.
 * An address we can't read is dropped, so a credit never links somewhere odd.
 */
export function unsplashReferralUrl(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const unsplashHost = host === "unsplash.com" || host.endsWith(".unsplash.com");
    if (!unsplashHost) return "";

    if (url.protocol === "http:") url.protocol = "https:";
    url.searchParams.set("utm_source", UNSPLASH_APP_NAME);
    url.searchParams.set("utm_medium", "referral");
    return url.toString();
  } catch {
    return "";
  }
}
