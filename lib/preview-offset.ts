import { unstable_cache } from "next/cache";
import { matchPreviewStart, type TranscriptWord } from "@/lib/preview-match";
import { parseSyncedLyrics } from "@/lib/scenes";

/**
 * Where Spotify's 30-second preview sits inside the full song.
 *
 * The embed clock starts at 0 for that clip, even when the clip is the
 * chorus. Many preview files carry the real start, in seconds, in an ID3
 * tag named metadata.json. About half don't. For those, Groq transcribes
 * the clip once and the words are matched to the timed lyrics.
 *
 * Server only. The browser never asks Spotify or Groq for this.
 */

const ONE_DAY_SECONDS = 86_400;
// A found start doesn't change. Keep it for a month.
const THIRTY_DAYS_SECONDS = 30 * ONE_DAY_SECONDS;

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// The turbo model hears less singing over a band. This one is still free.
const GROQ_MODEL = "whisper-large-v3";
// Whisper's prompt is short. A few lines of the song are enough to help
// it hear singing instead of inventing "We'll be right back."
const HINT_MAX_CHARS = 600;

type PreviewFile = { url: string | null; taggedStartMs: number | null };

/**
 * Milliseconds into the song, or null when we can't tell.
 * Missing lyrics or a missing Groq key leave the photos on the beat.
 */
export async function findPreviewStartMs(
  spotifyId: string,
  syncedLyrics: string | null,
  songDurationMs: number,
): Promise<number | null> {
  const file = await findPreviewFile(spotifyId);
  if (file.taggedStartMs != null) return file.taggedStartMs;
  if (!file.url || !syncedLyrics || !process.env.GROQ_API_KEY) return null;

  return findTranscribedStartMs(spotifyId, file.url, syncedLyrics, songDurationMs);
}

const findPreviewFile = unstable_cache(lookupPreviewFile, ["spotify-preview-file"], {
  revalidate: ONE_DAY_SECONDS,
});

// Keyed by the track. A failed request throws, so it isn't saved and
// the next listener tries again.
const findTranscribedStartMs = unstable_cache(
  transcribeAndMatch,
  ["spotify-preview-transcript-start-v2"],
  { revalidate: THIRTY_DAYS_SECONDS },
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

async function lookupPreviewFile(spotifyId: string): Promise<PreviewFile> {
  if (!/^[A-Za-z0-9]+$/.test(spotifyId)) return { url: null, taggedStartMs: null };

  const embed = await fetch(`https://open.spotify.com/embed/track/${spotifyId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!embed.ok) {
    throw new Error(`Spotify embed failed (${embed.status}).`);
  }

  const html = await embed.text();
  const urlMatch = html.match(/"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/);
  if (!urlMatch) return { url: null, taggedStartMs: null };

  const url = urlMatch[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const file = await fetch(url, {
    headers: { Range: "bytes=0-8191", "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!file.ok && file.status !== 206) {
    throw new Error(`Spotify preview file failed (${file.status}).`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return { url, taggedStartMs: readPreviewStartMs(bytes) };
}

async function transcribeAndMatch(
  _spotifyId: string,
  previewUrl: string,
  syncedLyrics: string,
  songDurationMs: number,
): Promise<number | null> {
  const lines = parseSyncedLyrics(syncedLyrics);
  const audio = await fetch(previewUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!audio.ok) {
    throw new Error(`Spotify preview file failed (${audio.status}).`);
  }
  const bytes = await audio.arrayBuffer();

  // Plain first. A hint can nudge Whisper toward words that aren't sung,
  // so it is only for clips it couldn't hear on its own.
  const plain = matchPreviewStart(await transcribePreview(bytes), lines, songDurationMs);
  if (plain != null) return plain;

  const hint = lyricHint(lines);
  if (!hint) return null;
  return matchPreviewStart(await transcribePreview(bytes, hint), lines, songDurationMs);
}

/** Each lyric line once, in order, cut to fit Whisper's prompt. */
function lyricHint(lines: { text: string }[]): string {
  const seen = new Set<string>();
  let hint = "";
  for (const line of lines) {
    const key = line.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const next = hint ? `${hint} ${line.text}` : line.text;
    if (next.length > HINT_MAX_CHARS) break;
    hint = next;
  }
  return hint;
}

async function transcribePreview(
  audio: ArrayBuffer,
  hint?: string,
): Promise<TranscriptWord[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY.");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "preview.mp3");
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("temperature", "0");
  if (hint) form.append("prompt", hint);

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Groq transcription failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    words?: { word?: string; start?: number }[];
  };
  return (data.words ?? [])
    .filter((item) => typeof item.word === "string" && typeof item.start === "number")
    .map((item) => ({
      word: item.word as string,
      startMs: Math.round((item.start as number) * 1000),
    }));
}
