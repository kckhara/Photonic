import { unstable_cache } from "next/cache";

/**
 * Where Spotify's 30-second preview sits inside the full song.
 *
 * The embed clock starts at 0 for that clip, even when the clip is the
 * chorus. The preview file itself carries the real start, in seconds,
 * in an ID3 tag named metadata.json. Lyrics can then use that offset.
 *
 * Server only. The browser never asks Spotify for this.
 */

const ONE_DAY_SECONDS = 86_400;

export const findPreviewStartMs = unstable_cache(
  lookupPreviewStartMs,
  ["spotify-preview-start"],
  { revalidate: ONE_DAY_SECONDS },
);

/**
 * Read start_time from the front of a Spotify preview file.
 * Returns milliseconds, or null when the tag is not there.
 * Zero is a real answer: that preview starts at the beginning.
 */
export function readPreviewStartMs(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const match = text.match(/"start_time"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

async function lookupPreviewStartMs(spotifyId: string): Promise<number | null> {
  if (!/^[A-Za-z0-9]+$/.test(spotifyId)) return null;

  const embed = await fetch(
    `https://open.spotify.com/embed/track/${spotifyId}`,
    {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    },
  );
  if (!embed.ok) {
    throw new Error(`Spotify embed failed (${embed.status}).`);
  }

  const html = await embed.text();
  const urlMatch = html.match(
    /"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/,
  );
  if (!urlMatch) return null;

  const previewUrl = urlMatch[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const file = await fetch(previewUrl, {
    headers: {
      Range: "bytes=0-8191",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!file.ok && file.status !== 206) {
    throw new Error(`Spotify preview file failed (${file.status}).`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return readPreviewStartMs(bytes);
}
