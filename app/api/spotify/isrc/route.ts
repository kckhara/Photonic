import { findSpotifyTrackIdByIsrc } from "@/lib/spotify";
import { type NextRequest } from "next/server";

/**
 * GET /api/spotify/isrc?isrc=USUG11904206
 *
 * Server-only route: uses our Spotify app keys to find a track ID.
 * The browser never sees the secret.
 */
export async function GET(request: NextRequest) {
  const isrc = request.nextUrl.searchParams.get("isrc")?.trim();

  if (!isrc) {
    return Response.json(
      { error: "Please provide an ISRC, like ?isrc=USUG11904206" },
      { status: 400 },
    );
  }

  try {
    const spotifyId = await findSpotifyTrackIdByIsrc(isrc);
    return Response.json({ isrc, spotifyId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong talking to Spotify.";
    return Response.json({ error: message }, { status: 500 });
  }
}
