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
 * Types a song or artist name, shows a dropdown, and tells the page
 * which row was chosen so the player can load it.
 */
export function SearchBox({
  onSelect,
  resetKey = 0,
}: {
  onSelect: (hit: SearchHit) => void;
  // Bumps when "New search" is clicked, so the field clears.
  resetKey?: number;
}) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<SongHit[]>([]);
  const [artists, setArtists] = useState<ArtistHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  // Which row the arrow keys are on. -1 means "none".
  const [activeIndex, setActiveIndex] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [seenReset, setSeenReset] = useState(resetKey);

  // "New search" clears the field. Focus happens after paint, below.
  if (resetKey !== seenReset) {
    setSeenReset(resetKey);
    setQuery("");
    setSongs([]);
    setArtists([]);
    setStatus("idle");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    if (resetKey === 0) return;
    inputRef.current?.focus();
  }, [resetKey]);

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
    setIsOpen(false);
    onSelect(hit);
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
      <label
        htmlFor="song-search"
        className="mb-2 block [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [line-height:var(--line-height-credits-caption)] [letter-spacing:var(--letter-spacing-credits-caption)] [color:var(--color-text-primary)]"
      >
        Song or musician
      </label>
      {/* The list is positioned against this box only, so it sits
          directly under the field and not under the hint text. */}
      <div className="relative">
        <input
          ref={inputRef}
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
          className="w-full rounded-[var(--radius-search)] bg-[var(--color-control-fill)] px-3 py-2 [font-size:var(--font-size-search)] [font-weight:var(--font-weight-search)] [line-height:var(--line-height-search)] [letter-spacing:var(--letter-spacing-search)] [color:var(--color-text-primary)] outline-none placeholder:[color:var(--color-text-secondary)]"
        />

        {showDropdown && (
          <div
            id="search-results"
            role="listbox"
            aria-label="Search results"
            className="absolute left-0 right-0 top-full z-10 mt-[var(--space-dropdown-gap)] rounded-[var(--radius-dropdown)] border-[length:var(--border-width)] border-solid [border-color:var(--color-border-subtle)] bg-[var(--color-surface-overlay)] [color:var(--color-text-primary)] shadow-[var(--shadow-overlay)]"
          >
          {status === "loading" && (
            <p className="px-3 py-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
              Searching…
            </p>
          )}

          {status === "error" && (
            <p className="px-3 py-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-primary)]">
              Search isn’t available right now. Try again in a moment.
            </p>
          )}

          {status === "done" && items.length === 0 && (
            <p className="px-3 py-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
              No matches.
            </p>
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
                  shape="avatar"
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
                    shape="art"
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

      <p className="mt-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
        Type at least 2 letters. Arrow keys move through the list, Enter
        chooses one.
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
      <p className="px-3 pt-2 uppercase [font-size:var(--font-size-dropdown-label)] [font-weight:var(--font-weight-dropdown-label)] [line-height:var(--line-height-dropdown-label)] [letter-spacing:var(--letter-spacing-dropdown-label)] [color:var(--color-text-secondary)]">
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
  shape,
  onHighlight,
  onChoose,
}: {
  id: string;
  active: boolean;
  artworkUrl: string | null;
  title: string;
  subtitle: string;
  shape: "avatar" | "art";
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
        active ? "bg-[var(--color-hover-row)]" : ""
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
          className={`size-[var(--space-dropdown-avatar)] shrink-0 bg-[var(--color-placeholder)] object-cover ${
            shape === "avatar"
              ? "rounded-[var(--radius-avatar)]"
              : "rounded-[var(--radius-song-art)]"
          }`}
        />
      ) : (
        <span
          className={`size-[var(--space-dropdown-avatar)] shrink-0 bg-[var(--color-placeholder)] ${
            shape === "avatar"
              ? "rounded-[var(--radius-avatar)]"
              : "rounded-[var(--radius-song-art)]"
          }`}
        />
      )}
      <span className="min-w-0">
        <span className="block truncate [font-size:var(--font-size-search-result-name)] [font-weight:var(--font-weight-search-result-name)] [color:var(--color-text-primary)]">
          {title}
        </span>
        <span className="block truncate [font-size:var(--font-size-search-meta)] [font-weight:var(--font-weight-search-meta)] [color:var(--color-text-secondary)]">
          {subtitle}
        </span>
      </span>
    </li>
  );
}
