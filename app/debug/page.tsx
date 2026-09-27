"use client";

import { useState, type FormEvent } from "react";

/**
 * Temporary page for checking the song package before the player exists.
 * Open http://localhost:3000/debug and paste a Deezer id.
 */
export default function DebugPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-12 px-6 py-10">
      <header>
        <p className="text-sm opacity-60">Phase 3 debug page</p>
        <h1 className="mt-1 text-2xl font-semibold">Song package</h1>
        <p className="mt-2 text-sm opacity-70">
          Looks up one Deezer song and shows the JSON our server built. This
          page goes away before launch.
        </p>
      </header>

      <LookupForm
        title="Song"
        hint="Deezer song id. Try 908604612 (Blinding Lights), 138547415 (Creep), or 2711778 (So What, instrumental)."
        placeholder="908604612"
        pathPrefix="/api/song/"
      />

      <LookupForm
        title="Artist’s top song"
        hint="Deezer artist id. Try 399 (Radiohead). Copy the deezerId from the result into the song box above to see the full package."
        placeholder="399"
        pathPrefix="/api/artist-top/"
      />
    </main>
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
          className="rounded border border-foreground/30 px-3 py-2 text-sm disabled:opacity-40"
        >
          {status === "loading" ? "Loading…" : "Look up"}
        </button>
      </form>

      {status === "error" && json === "" && (
        <p className="text-sm">Could not reach the server. Is npm run dev still running?</p>
      )}

      {json !== "" && (
        <pre className="overflow-x-auto rounded border border-foreground/20 bg-foreground/5 p-4 font-mono text-sm">
          {json}
        </pre>
      )}
    </section>
  );
}
