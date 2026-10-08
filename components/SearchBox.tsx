"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ArtistHit, SearchHit, SongHit } from "@/lib/deezer";
import { playWarmedSpotify, prepareMobilePlayback } from "@/lib/spotify-embed";

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
  onOpenChange,
}: {
  onSelect: (hit: SearchHit) => void;
  // Bumps when the field should clear.
  resetKey?: number;
  // True while the results list is open, so the homepage intro can step aside.
  onOpenChange?: (open: boolean) => void;
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
  // Spotify ids for the open results, so a tap can start playback
  // before the song package comes back. Keys are "song:1" / "artist:2".
  const playbackIds = useRef(new Map<string, string>());
  const [seenReset, setSeenReset] = useState(resetKey);

  // A reset clears the field. Focus happens after paint, below.
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

  // Phones block playback that starts after this list closes, so preload
  // each row's Spotify embed while the person is still choosing.
  useEffect(() => {
    const controller = new AbortController();
    void prepareMobilePlayback(songs, artists, controller.signal).then((ids) => {
      if (!controller.signal.aborted) playbackIds.current = ids;
    });
    return () => controller.abort();
  }, [songs, artists]);

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
    // play() has to run inside this tap. After await, a phone will ignore it.
    const spotifyId = playbackIds.current.get(`${hit.type}:${hit.id}`);
    if (spotifyId) playWarmedSpotify(spotifyId);
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

  useEffect(() => {
    onOpenChange?.(showDropdown);
  }, [onOpenChange, showDropdown]);

  function clearQuery() {
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div ref={boxRef} className="w-full">
      <label htmlFor="song-search" className="sr-only">
        Search a song or musician
      </label>
      {/* The list is positioned against this box only, so it sits
          directly under the field. */}
      <div className="relative">
        <div className={`search-bar${query ? " is-filled" : ""}`}>
          <span className="search-bar-icon" aria-hidden="true">
            <SearchIcon />
          </span>
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
            placeholder="Search a song or musician"
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="search-results"
            aria-activedescendant={showDropdown ? activeId : undefined}
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              className="search-bar-clear"
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearQuery}
            >
              <ClearIcon />
            </button>
          )}
        </div>

        {showDropdown && (
          <div
            id="search-results"
            role="listbox"
            aria-label="Search results"
            className="search-results"
          >
            {status === "loading" && (
              <p className="search-results-status">Searching…</p>
            )}

            {status === "error" && (
              <p className="search-results-status">
                Search isn’t available right now. Try again in a moment.
              </p>
            )}

            {status === "done" && items.length === 0 && (
              <p className="search-results-status">No matches.</p>
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

            {artists.length > 0 && songs.length > 0 && (
              <hr className="search-results-divider" />
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
                      length={formatLength(song.durationSeconds)}
                      shape="song"
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
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-icon)]"
      fill="none"
    >
      <circle
        cx="10.5"
        cy="10.5"
        r="6.25"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
      />
      <path
        d="M15.2 15.2 20 20"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-icon)]"
      fill="none"
    >
      <path
        d="M7.5 7.5 16.5 16.5M16.5 7.5 7.5 16.5"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
        strokeLinecap="round"
      />
    </svg>
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
      <p className="search-results-label">{label}</p>
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
  length,
  shape,
  onHighlight,
  onChoose,
}: {
  id: string;
  active: boolean;
  artworkUrl: string | null;
  title: string;
  subtitle: string;
  length?: string;
  shape: "avatar" | "song";
  onHighlight: () => void;
  onChoose: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [artworkUrl]);

  const showImage = Boolean(artworkUrl) && !imageFailed;

  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      // pointerdown (not click) so the row is chosen before the input
      // loses focus, and so play() still counts as the tap on a phone.
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onChoose();
      }}
      onMouseEnter={onHighlight}
      className={`search-result${active ? " is-active" : ""}`}
    >
      <span
        className={`search-result-art${shape === "avatar" ? " is-avatar" : " is-song"}`}
      >
        {showImage ? (
          // A plain image tag, not Next's image helper, so Deezer's
          // artwork links work without extra image settings.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkUrl ?? undefined}
            alt=""
            width={40}
            height={40}
            onError={() => setImageFailed(true)}
          />
        ) : shape === "avatar" ? (
          <PersonIcon />
        ) : (
          <NoteIcon />
        )}
      </span>
      <span className="search-result-copy">
        <span className="search-result-title">{title}</span>
        <span className="search-result-meta">{subtitle}</span>
      </span>
      {length && <span className="search-result-length">{length}</span>}
    </li>
  );
}

/** m:ss, matching the length shown beside a song. */
function formatLength(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-icon)]"
      fill="none"
    >
      <circle
        cx="12"
        cy="8"
        r="3.25"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
      />
      <path
        d="M5.6 19.2c.7-3.1 3-4.7 6.4-4.7s5.7 1.6 6.4 4.7"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-icon)]"
      fill="none"
    >
      <path
        d="M9 17.2V6.4l8.2-1.6v9.1"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke-fine)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="6.8"
        cy="17.2"
        r="2.15"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke-fine)"
      />
      <circle
        cx="15"
        cy="14"
        r="2.15"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke-fine)"
      />
    </svg>
  );
}
