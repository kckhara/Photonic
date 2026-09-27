"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ArtistHit, SearchHit, SongHit } from "@/lib/deezer";

// Wait this long after the last keystroke before searching.
// Stops us from calling the server on every single letter.
const PAUSE_MS = 250;
const MIN_CHARACTERS = 2;

type SearchStatus = "idle" | "loading" | "done" | "error";

/**
 * Homepage search box.
 * Types a song or artist name, shows a dropdown, and logs the choice.
 * Playing the song comes in a later phase — this only records the pick.
 */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<SongHit[]>([]);
  const [artists, setArtists] = useState<ArtistHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  // Which row the arrow keys are on. -1 means "none".
  const [activeIndex, setActiveIndex] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);

  // One flat list so arrow keys can move through artists, then songs.
  const items: SearchHit[] = [...artists, ...songs];

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_CHARACTERS) {
      setSongs([]);
      setArtists([]);
      setStatus("idle");
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setStatus("loading");
      setIsOpen(true);

      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as {
          songs?: SongHit[];
          artists?: ArtistHit[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(body.error || "Search failed");
        }

        const nextArtists = body.artists ?? [];
        const nextSongs = body.songs ?? [];
        setArtists(nextArtists);
        setSongs(nextSongs);
        setStatus("done");
        // Highlight the first result so Enter works right away.
        setActiveIndex(nextArtists.length + nextSongs.length > 0 ? 0 : -1);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (cancelled) return;
        setArtists([]);
        setSongs([]);
        setStatus("error");
        setActiveIndex(-1);
        setIsOpen(true);
      }
    }, PAUSE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Close the list when the click lands outside the search box.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function choose(hit: SearchHit) {
    // Later phases will play this. For now we only log it.
    console.log("Selected search result:", hit);
    setIsOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length === 0) return;
      setIsOpen(true);
      setActiveIndex((current) => {
        // Opening a closed list starts at the top instead of skipping ahead.
        if (!isOpen || current < 0) return 0;
        return Math.min(current + 1, items.length - 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (!isOpen) return;
      const hit = items[activeIndex];
      if (hit) choose(hit);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  const showDropdown = isOpen && query.trim().length >= MIN_CHARACTERS;
  const activeId =
    activeIndex >= 0 ? `search-option-${activeIndex}` : undefined;

  return (
    <div ref={boxRef} className="w-full">
      <label htmlFor="song-search" className="mb-2 block text-sm">
        Song or musician
      </label>
      {/* The list is positioned against this box only, so it sits
          directly under the field and not under the hint text. */}
      <div className="relative">
        <input
          id="song-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (query.trim().length >= MIN_CHARACTERS) setIsOpen(true);
          }}
          placeholder="Search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="search-results"
          aria-activedescendant={showDropdown ? activeId : undefined}
          aria-autocomplete="list"
          className="w-full rounded border border-foreground/30 bg-background px-3 py-2 text-foreground outline-none focus:border-foreground"
        />

        {showDropdown && (
          <div
            id="search-results"
            role="listbox"
            aria-label="Search results"
            className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-foreground/30 bg-background text-foreground"
          >
          {status === "loading" && (
            <p className="px-3 py-2 text-sm opacity-70">Searching…</p>
          )}

          {status === "error" && (
            <p className="px-3 py-2 text-sm">
              Search isn’t available right now. Try again in a moment.
            </p>
          )}

          {status === "done" && items.length === 0 && (
            <p className="px-3 py-2 text-sm">No matches.</p>
          )}

          {artists.length > 0 && (
            <ResultGroup label="Artists">
              {artists.map((artist, index) => (
                <ResultRow
                  key={`artist-${artist.id}`}
                  id={`search-option-${index}`}
                  active={index === activeIndex}
                  artworkUrl={artist.artworkUrl}
                  title={artist.name}
                  subtitle="Artist"
                  onHighlight={() => setActiveIndex(index)}
                  onChoose={() => choose(artist)}
                />
              ))}
            </ResultGroup>
          )}

          {songs.length > 0 && (
            <ResultGroup label="Songs">
              {songs.map((song, index) => {
                const optionIndex = artists.length + index;
                return (
                  <ResultRow
                    key={`song-${song.id}`}
                    id={`search-option-${optionIndex}`}
                    active={optionIndex === activeIndex}
                    artworkUrl={song.artworkUrl}
                    title={song.title}
                    subtitle={song.artistName}
                    onHighlight={() => setActiveIndex(optionIndex)}
                    onChoose={() => choose(song)}
                  />
                );
              })}
            </ResultGroup>
          )}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm opacity-70">
        Type at least 2 letters. Arrow keys move through the list, Enter
        chooses one. The choice is logged in the browser console for now.
      </p>
    </div>
  );
}

function ResultGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="px-3 pt-2 text-xs uppercase tracking-wide opacity-60">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function ResultRow({
  id,
  active,
  artworkUrl,
  title,
  subtitle,
  onHighlight,
  onChoose,
}: {
  id: string;
  active: boolean;
  artworkUrl: string | null;
  title: string;
  subtitle: string;
  onHighlight: () => void;
  onChoose: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      // mousedown (not click) so the row is chosen before the input loses focus.
      onMouseDown={(event) => {
        event.preventDefault();
        onChoose();
      }}
      onMouseEnter={onHighlight}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
        active ? "bg-foreground/10" : ""
      }`}
    >
      {artworkUrl ? (
        // A plain image tag, not Next's image helper, so Deezer's
        // artwork links work without extra image settings.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 bg-foreground/10 object-cover"
        />
      ) : (
        <span className="h-10 w-10 shrink-0 bg-foreground/10" />
      )}
      <span className="min-w-0">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-sm opacity-70">{subtitle}</span>
      </span>
    </li>
  );
}
