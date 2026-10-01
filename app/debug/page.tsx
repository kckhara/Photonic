"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  BRIGHT_LIGHTNESS,
  BRIGHT_POINTS,
  FREQUENT_PHOTOGRAPHER_MIN_COUNT,
  FREQUENT_PHOTOGRAPHER_POINTS,
  MIN_PHOTO_WIDTH,
  SATURATED_LEVEL,
  SATURATED_POINTS,
  STOCK_WORD_POINTS,
} from "@/lib/stock-words";
import type { Photo, Scene, SongPackage } from "@/lib/types";

/**
 * Temporary page for checking a song package, including picture-words
 * and photos. Open http://localhost:3000/debug and paste a Deezer id.
 * This page goes away before launch.
 */
export default function DebugPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-10">
      <header>
        <p className="text-sm opacity-60">Debug</p>
        <h1 className="mt-1 text-2xl font-semibold">Song package</h1>
        <p className="mt-2 text-sm opacity-70">
          Looks up one Deezer song and shows the scenes: when they start, the
          picture-word, and the photos. The first lookup can take a few
          seconds. The same song should be quicker for the next 24 hours.
        </p>
      </header>

      <WonderCompare />

      <SongLookup />

      <LookupForm
        title="Artist’s top song"
        hint="Deezer artist id. Try 399 (Radiohead). Copy the deezerId from the result into the song box above to see scenes and photos."
        placeholder="399"
        pathPrefix="/api/artist-top/"
      />
    </main>
  );
}

type ScoredView = {
  photo: Photo;
  score: number;
  reasons: string[];
  lightness: number | null;
  saturation: number | null;
  photographerCount: number;
  chosen: boolean;
};

type WonderResult = {
  keyword: string;
  styleWord: string;
  query: string;
  source: "style" | "keyword" | "curated";
  photos: Photo[];
  scored: ScoredView[];
  skippedNarrow: number;
  blocklist: string[];
  styleWords: string[];
};

function WonderCompare() {
  const [result, setResult] = useState<WonderResult | null>(null);
  const [errorText, setErrorText] = useState("");
  const [status, setStatus] = useState<"loading" | "done" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/debug/wonder");
        const data: unknown = await response.json();

        if (cancelled) return;

        if (!response.ok || !isWonderResult(data)) {
          setErrorText(errorMessage(data));
          setStatus("error");
          return;
        }

        setResult(data);
        setStatus("done");
      } catch {
        if (cancelled) return;
        setErrorText(
          "Could not reach the server. Is npm run dev still running?",
        );
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Photo search: “wonder”</h2>
      <p className="text-sm opacity-70">
        This is a sample of the first scene&apos;s search. The search adds one
        style word and skips descriptions on the blocklist. Photos under{" "}
        {MIN_PHOTO_WIDTH}px wide are skipped. The rest are scored, and the
        lowest scores are picked at random. A long lyric line gets a new photo
        each time the picture changes. Refresh this page for a new pick.
      </p>
      <p className="text-sm opacity-70">
        Very bright (brightness at least {BRIGHT_LIGHTNESS}) adds {BRIGHT_POINTS}.
        Very saturated (saturation at least {SATURATED_LEVEL}) adds{" "}
        {SATURATED_POINTS}. Each stock word in the description or the url adds{" "}
        {STOCK_WORD_POINTS}. The photographer with the most cached photos adds{" "}
        {FREQUENT_PHOTOGRAPHER_POINTS}, once they have at least{" "}
        {FREQUENT_PHOTOGRAPHER_MIN_COUNT}. Edit the numbers and the word list
        in <span className="font-mono">lib/stock-words.ts</span>. Style words
        and the blocklist live in{" "}
        <span className="font-mono">lib/style-words.ts</span> and{" "}
        <span className="font-mono">lib/photo-blocklist.ts</span>.
      </p>

      {status === "loading" && (
        <p className="text-sm">Asking Pexels for “wonder”…</p>
      )}
      {status === "error" && <p className="text-sm">{errorText}</p>}

      {result && (
        <>
          <PhotoColumn
            title={sourceLabel(result)}
            query={result.query}
            photos={result.photos}
            scored={result.scored}
            skippedNarrow={result.skippedNarrow}
          />
          <p className="text-sm opacity-70">
            Style words, in order: {result.styleWords.join(", ")}.
          </p>
          <p className="text-sm opacity-70">
            Skipped when the description contains: {result.blocklist.join(", ")}.
          </p>
        </>
      )}
    </section>
  );
}

function sourceLabel(result: WonderResult): string {
  if (result.source === "keyword") {
    return `“${result.keyword} ${result.styleWord}” had fewer than 3 usable photos, so these are from the word alone`;
  }
  if (result.source === "curated") {
    return "No matching photos, so these are general Pexels photos";
  }
  return `Search with the style word “${result.styleWord}”`;
}

function PhotoColumn({
  title,
  query,
  photos,
  scored,
  skippedNarrow,
}: {
  title: string;
  query: string;
  photos: Photo[];
  scored: ScoredView[];
  skippedNarrow: number;
}) {
  const picked = scored.filter((item) => item.chosen).length;
  const shown = scored.length > 0 ? scored : photos.map(unscoredView);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm opacity-70">
          Search: “{query}” · {shown.length}{" "}
          {shown.length === 1 ? "photo" : "photos"} scored · {picked} picked
          {skippedNarrow > 0
            ? ` · ${skippedNarrow} skipped under ${MIN_PHOTO_WIDTH}px`
            : ""}
        </p>
        <p className="text-sm opacity-70">Lowest scores first.</p>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm">No photos came back.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => (
            <li key={item.photo.id}>
              <figure className="space-y-1">
                <PhotoThumb
                  photo={item.photo}
                  className="aspect-[3/2] w-full rounded object-cover"
                  width={800}
                />
                <figcaption className="space-y-1 text-xs">
                  <p className="font-medium">
                    Score {item.score}
                    {item.chosen ? " · Picked" : ""}
                  </p>
                  {item.reasons.length === 0 ? (
                    <p className="opacity-70">No stock points.</p>
                  ) : (
                    <ul className="space-y-0.5 opacity-80">
                      {item.reasons.map((reason, index) => (
                        <li key={`${reason}-${index}`}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <p className="opacity-60">{scoreFacts(item)}</p>
                  <p className="opacity-70">{item.photo.alt}</p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function unscoredView(photo: Photo): ScoredView {
  return {
    photo,
    score: photo.stockScore ?? 0,
    reasons: photo.stockReasons ?? [],
    lightness: null,
    saturation: null,
    photographerCount: 0,
    chosen: true,
  };
}

function scoreFacts(item: ScoredView): string {
  const brightness =
    item.lightness == null ? "no brightness" : `brightness ${item.lightness.toFixed(2)}`;
  const saturation =
    item.saturation == null
      ? "no saturation"
      : `saturation ${item.saturation.toFixed(2)}`;
  const width =
    item.photo.width && item.photo.width > 0 ? `${item.photo.width}px wide` : "width unknown";
  const photographer =
    item.photographerCount === 1
      ? "1 cached photo from this photographer"
      : `${item.photographerCount} cached photos from this photographer`;

  return `${brightness} · ${saturation} · ${width} · ${photographer}`;
}

function SongLookup() {
  const [id, setId] = useState("");
  const [song, setSong] = useState<SongPackage | null>(null);
  const [errorText, setErrorText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = id.trim();
    if (!trimmed) return;

    setStatus("loading");
    setSong(null);
    setErrorText("");

    try {
      const response = await fetch(`/api/song/${encodeURIComponent(trimmed)}`);
      const data: unknown = await response.json();

      if (!response.ok) {
        setErrorText(errorMessage(data));
        setStatus("error");
        return;
      }

      if (!isSongPackage(data)) {
        setErrorText("The server sent a song package we couldn’t read.");
        setStatus("error");
        return;
      }

      setSong(data);
      setStatus("done");
    } catch {
      setErrorText("Could not reach the server. Is npm run dev still running?");
      setStatus("error");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Song</h2>
      <p className="text-sm opacity-70">
        Deezer song id. Try 908604612 (Blinding Lights), 138547415 (Creep), or
        2711778 (So What, instrumental).
      </p>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="908604612"
          inputMode="numeric"
          aria-label="Song"
          className="w-full rounded border border-foreground/30 bg-background px-3 py-2 outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={status === "loading" || id.trim() === ""}
          className="shrink-0 whitespace-nowrap rounded border border-foreground/30 px-3 py-2 text-sm disabled:opacity-40"
        >
          {status === "loading" ? "Loading…" : "Look up"}
        </button>
      </form>

      {status === "error" && <p className="text-sm">{errorText}</p>}

      {song && <SceneList song={song} />}
    </section>
  );
}

function SceneList({ song }: { song: SongPackage }) {
  const words = new Set(
    song.scenes.map((scene) => scene.keyword).filter((keyword) => keyword),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm opacity-70">
        {song.title} by {song.artist} · {lyricsLabel(song.lyricsType)} ·{" "}
        {words.size === 0
          ? "curated photos"
          : `${words.size} ${words.size === 1 ? "word" : "words"}`}{" "}
        · {song.scenes.length} {song.scenes.length === 1 ? "scene" : "scenes"}
      </p>

      {song.scenes.length === 0 ? (
        <p className="text-sm">No scenes were built for this song.</p>
      ) : (
        <ol className="space-y-5">
          {song.scenes.map((scene) => (
            <SceneRow key={`${scene.startMs}-${scene.keyword}`} scene={scene} />
          ))}
        </ol>
      )}

      <details className="rounded border border-foreground/20 bg-foreground/5 p-4">
        <summary className="cursor-pointer text-sm">Show the raw JSON</summary>
        <pre className="mt-3 overflow-x-auto font-mono text-sm">
          {JSON.stringify(song, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function SceneRow({ scene }: { scene: Scene }) {
  const label = scene.titleCard
    ? "Title card"
    : scene.keyword || "Curated photos (no lyrics)";

  return (
    <li className="space-y-2 border-b border-foreground/15 pb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm">
          {formatTime(scene.startMs)} – {formatTime(scene.endMs)}
        </span>
        <span className="font-medium">{label}</span>
      </div>

      {scene.video && (
        <p className="text-sm opacity-70">
          Clip by {scene.video.videographer}
          {scene.keywordMentions != null && scene.keywordMentions > 1
            ? " · repeated word (Mix plays this clip)"
            : ""}
        </p>
      )}
      {!scene.titleCard && scene.keyword && !scene.video && (
        <p className="text-sm opacity-70">No landscape clip — photos stay.</p>
      )}

      {scene.titleCard ? (
        <p className="text-sm opacity-70">
          Album cover, with a countdown to the first photo or clip.
        </p>
      ) : scene.photos.length === 0 ? (
        <p className="text-sm opacity-70">No photos for this word.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {scene.photos.map((photo, index) => (
            <li key={`${scene.startMs}-${photo.id}-${index}`} className="max-w-40">
              <PhotoThumb photo={photo} />
              <PhotoScore photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PhotoScore({ photo }: { photo: Photo }) {
  if (photo.stockScore == null) return null;
  const reasons = photo.stockReasons ?? [];

  return (
    <div className="mt-1 text-[11px] leading-snug">
      <p className="font-medium">Score {photo.stockScore}</p>
      {reasons.length === 0 ? (
        <p className="opacity-60">No stock points.</p>
      ) : (
        <ul className="opacity-70">
          {reasons.map((reason, index) => (
            <li key={`${reason}-${index}`}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhotoThumb({
  photo,
  className = "h-20 w-32 rounded object-cover",
  width = 320,
}: {
  photo: Photo;
  className?: string;
  width?: number;
}) {
  const image = (
    // Temporary debug thumbnail. next/image would need a Pexels host
    // setting we don't need once this page is removed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnailUrl(photo.src, width)}
      alt={photo.alt}
      className={className}
      style={{ backgroundColor: photo.avgColor }}
    />
  );

  const href = photo.pageUrl || photo.pexelsUrl;
  if (!href) return image;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {image}
    </a>
  );
}

function LookupForm({
  title,
  hint,
  placeholder,
  pathPrefix,
}: {
  title: string;
  hint: string;
  placeholder: string;
  pathPrefix: string;
}) {
  const [id, setId] = useState("");
  const [json, setJson] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = id.trim();
    if (!trimmed) return;

    setStatus("loading");
    setJson("");

    try {
      const response = await fetch(
        `${pathPrefix}${encodeURIComponent(trimmed)}`,
      );
      const data: unknown = await response.json();
      setJson(JSON.stringify(data, null, 2));
      setStatus(response.ok ? "done" : "error");
    } catch {
      setJson("");
      setStatus("error");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm opacity-70">{hint}</p>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          aria-label={title}
          className="w-full rounded border border-foreground/30 bg-background px-3 py-2 outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={status === "loading" || id.trim() === ""}
          className="shrink-0 whitespace-nowrap rounded border border-foreground/30 px-3 py-2 text-sm disabled:opacity-40"
        >
          {status === "loading" ? "Loading…" : "Look up"}
        </button>
      </form>

      {status === "error" && json === "" && (
        <p className="text-sm">
          Could not reach the server. Is npm run dev still running?
        </p>
      )}

      {json !== "" && (
        <pre className="overflow-x-auto rounded border border-foreground/20 bg-foreground/5 p-4 font-mono text-sm">
          {json}
        </pre>
      )}
    </section>
  );
}

function lyricsLabel(lyricsType: SongPackage["lyricsType"]): string {
  if (lyricsType === "synced") return "Synced lyrics";
  if (lyricsType === "plain") return "Plain lyrics, spread across the song";
  return "No lyrics";
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Ask the image host for a small crop so the debug page doesn't download
// the full-size photo for every thumbnail.
function thumbnailUrl(src: string, width: number): string {
  try {
    const url = new URL(src);
    if (url.hostname === "images.unsplash.com") {
      url.searchParams.set("w", String(width));
      url.searchParams.set("h", String(Math.round(width * 0.625)));
      url.searchParams.set("fit", "crop");
      url.searchParams.set("q", "70");
      return url.toString();
    }

    url.searchParams.set("auto", "compress");
    url.searchParams.set("cs", "tinysrgb");
    url.searchParams.set("w", String(width));
    url.searchParams.set("h", String(Math.round(width * 0.625)));
    url.searchParams.set("fit", "crop");
    return url.toString();
  } catch {
    return src;
  }
}

function isWonderResult(data: unknown): data is WonderResult {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<WonderResult>;
  return (
    typeof value.keyword === "string" &&
    typeof value.styleWord === "string" &&
    typeof value.query === "string" &&
    (value.source === "style" ||
      value.source === "keyword" ||
      value.source === "curated") &&
    Array.isArray(value.photos) &&
    Array.isArray(value.scored) &&
    value.scored.every(isScoredView) &&
    typeof value.skippedNarrow === "number" &&
    Array.isArray(value.blocklist) &&
    Array.isArray(value.styleWords)
  );
}

function isScoredView(value: unknown): value is ScoredView {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ScoredView>;
  return (
    typeof item.score === "number" &&
    Array.isArray(item.reasons) &&
    (item.lightness == null || typeof item.lightness === "number") &&
    (item.saturation == null || typeof item.saturation === "number") &&
    typeof item.photographerCount === "number" &&
    typeof item.chosen === "boolean" &&
    !!item.photo &&
    typeof item.photo === "object"
  );
}

function isSongPackage(data: unknown): data is SongPackage {
  if (!data || typeof data !== "object") return false;
  const song = data as Partial<SongPackage>;
  return typeof song.title === "string" && Array.isArray(song.scenes);
}

function errorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Something went wrong while loading this song.";
}
