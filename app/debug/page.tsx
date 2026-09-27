"use client";

import { useState, type FormEvent } from "react";
import type { Photo, Scene, SongPackage } from "@/lib/types";

/**
 * Temporary page for checking a song package, including picture-words
 * and photos. Open http://localhost:3000/debug and paste a Deezer id.
 * This page goes away before launch.
 */
export default function DebugPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6 py-10">
      <header>
        <p className="text-sm opacity-60">Debug</p>
        <h1 className="mt-1 text-2xl font-semibold">Song package</h1>
        <p className="mt-2 text-sm opacity-70">
          Looks up one Deezer song and shows the scenes: when they start, the
          picture-word, and the photos. The first lookup can take a few
          seconds. The same song should be quicker for the next 24 hours.
        </p>
      </header>

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
  const label = scene.keyword || "Curated photos (no lyrics)";

  return (
    <li className="space-y-2 border-b border-foreground/15 pb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm">
          {formatTime(scene.startMs)} – {formatTime(scene.endMs)}
        </span>
        <span className="font-medium">{label}</span>
      </div>

      {scene.photos.length === 0 ? (
        <p className="text-sm opacity-70">No photos for this word.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {scene.photos.map((photo, index) => (
            <li key={`${scene.startMs}-${photo.id}-${index}`}>
              <PhotoThumb photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PhotoThumb({ photo }: { photo: Photo }) {
  const image = (
    // Temporary debug thumbnail. next/image would need a Pexels host
    // setting we don't need once this page is removed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnailUrl(photo.src)}
      alt={photo.alt}
      className="h-20 w-32 rounded object-cover"
      style={{ backgroundColor: photo.avgColor }}
    />
  );

  if (!photo.pexelsUrl) return image;

  return (
    <a href={photo.pexelsUrl} target="_blank" rel="noopener noreferrer">
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

// Ask Pexels' image host for a small crop so the debug page doesn't download
// the full-size photo for every thumbnail.
function thumbnailUrl(src: string): string {
  try {
    const url = new URL(src);
    url.searchParams.set("auto", "compress");
    url.searchParams.set("cs", "tinysrgb");
    url.searchParams.set("w", "320");
    url.searchParams.set("h", "200");
    url.searchParams.set("fit", "crop");
    return url.toString();
  } catch {
    return src;
  }
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
