import {
  isUnsplashDownloadLocation,
  triggerUnsplashDownload,
} from "@/lib/unsplash";

/**
 * POST /api/unsplash/download
 *
 * Pings Unsplash the first time one of their photos is shown.
 * The browser sends the download address that came with the photo.
 * The access key is added here and never sent back.
 */

export async function POST(request: Request) {
  let downloadLocation = "";

  try {
    const body = (await request.json()) as { downloadLocation?: unknown };
    if (typeof body.downloadLocation === "string") {
      downloadLocation = body.downloadLocation;
    }
  } catch {
    return new Response(null, { status: 400 });
  }

  if (!isUnsplashDownloadLocation(downloadLocation)) {
    return new Response(null, { status: 400 });
  }

  await triggerUnsplashDownload(downloadLocation);
  return new Response(null, { status: 204 });
}
