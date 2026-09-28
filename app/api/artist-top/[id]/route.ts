import { getArtistTopSong } from "@/lib/deezer";

/**
 * GET /api/artist-top/399
 *
 * Deezer's most popular song for one artist. The homepage will use this
 * when someone picks a musician instead of a specific song.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const artistId = Number(id);

  if (!Number.isInteger(artistId) || artistId <= 0) {
    return Response.json(
      { error: "That doesn’t look like a Deezer artist id." },
      { status: 400 },
    );
  }

  try {
    const song = await getArtistTopSong(artistId);

    if (!song) {
      return Response.json(
        { error: "No top song found for that artist." },
        { status: 404 },
      );
    }

    return Response.json(song);
  } catch (error) {
    console.error("Artist top song failed", error);
    return Response.json(
      { error: "We couldn’t load this musician. Please try again." },
      { status: 500 },
    );
  }
}
