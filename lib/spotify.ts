/**
 * Spotify helpers that run on the server only.
 *
 * This file talks to Spotify using our app's ID and secret (from .env.local).
 * The secret never goes to the browser.
 */

// Keep the last token in memory so we don't ask Spotify for a new one on every request.
// Tokens last about 1 hour.
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

/**
 * Get an "app-only" Spotify access token (client credentials).
 * This is not a user's login — it only lets us search for tracks.
 */
export async function getSpotifyAppToken(): Promise<string> {
  const now = Date.now();

  // Reuse a token if it still has at least 60 seconds left.
  if (cachedToken && now < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Spotify keys. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local (and restart npm run dev).",
    );
  }

  // Spotify expects: Basic + base64(clientId:clientSecret)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(
      `Spotify token request failed (${response.status}). Check that your Client ID and Secret are correct.`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

/**
 * Look up a Spotify track ID using an ISRC (the universal song ID from Deezer).
 * Returns null if Spotify has no matching track.
 */
export async function findSpotifyTrackIdByIsrc(
  isrc: string,
): Promise<string | null> {
  const token = await getSpotifyAppToken();

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", `isrc:${isrc}`);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Spotify search failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    tracks?: { items?: { id: string }[] };
  };

  const trackId = data.tracks?.items?.[0]?.id ?? null;
  return trackId;
}
