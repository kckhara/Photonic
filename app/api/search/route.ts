import { searchDeezer } from "@/lib/deezer";
import { type NextRequest } from "next/server";

/**
 * GET /api/search?q=radiohead
 *
 * The browser calls this. We ask Deezer, then send back a short list of
 * songs and artists. No API key is involved.
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
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong talking to Deezer.";
    return Response.json({ error: message }, { status: 500 });
  }
}
