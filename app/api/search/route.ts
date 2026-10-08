import { searchDeezer } from "@/lib/deezer";
import { type NextRequest } from "next/server";

/**
 * GET /api/search?q=radiohead
 *
 * The browser calls this. We ask Deezer, then send back a short list of
 * songs and artists. Songs Deezer's search misses are filled in from Spotify.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  // The search box also waits for 2 characters. This is a second check
  // so a short or empty query never reaches Deezer.
  if (query.length < 2) {
    return Response.json({ songs: [], artists: [] });
  }

  try {
    const results = await searchDeezer(query);
    return Response.json(results);
  } catch (error) {
    // The search box shows its own sentence. This one is here so a
    // failed search never returns a raw Deezer error.
    console.error("Search failed", error);
    return Response.json(
      { error: "Search isn’t available right now. Try again in a moment." },
      { status: 500 },
    );
  }
}
