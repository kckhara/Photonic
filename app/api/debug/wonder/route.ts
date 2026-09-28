import { PHOTO_BLOCKLIST } from "@/lib/photo-blocklist";
import { chooseScenePhotos } from "@/lib/pexels";
import { STYLE_WORDS } from "@/lib/style-words";

const KEYWORD = "wonder";

// Always run on the server. This lookup needs the Pexels key, which is
// not available when the site is built.
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/wonder
 *
 * Photos for the word "wonder", using the same rules as the first scene
 * of a song. Used only by the /debug page. The Pexels key stays on the server.
 */
export async function GET() {
  try {
    const choice = await chooseScenePhotos(KEYWORD, 0, new Set());

    return Response.json({
      keyword: KEYWORD,
      styleWord: choice.styleWord,
      query: choice.query,
      source: choice.source,
      photos: choice.photos,
      blocklist: PHOTO_BLOCKLIST,
      styleWords: STYLE_WORDS,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while loading photos.";
    return Response.json({ error: message }, { status: 500 });
  }
}
