"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Photo, SongPackage } from "@/lib/types";

/**
 * The screen that appears when a full song finishes (plan section 5.5).
 *
 * It names the musician, then shows every photo that actually appeared,
 * in a grid. The photographer's name under each picture links to their
 * Pexels profile. The picture itself links to that photo's page on Pexels.
 *
 * A 30-second preview does not use this screen. That ending stays on
 * the Spotify login prompt.
 *
 * Simple on purpose — the real design comes in Phase 10.
 * "Footage by" (videographers) waits for Phase 9B.
 */

export function Credits({
  song,
  photos,
  onPlayAgain,
  onNewSearch,
}: {
  song: SongPackage;
  // Photos that really appeared on screen, in the order they appeared.
  photos: Photo[];
  onPlayAgain: () => void;
  onNewSearch: () => void;
}) {
  const shown = uniquePhotos(photos);
  const panelRef = useRef<HTMLDivElement>(null);

  // Open on the song title. The Play again button used to take focus
  // immediately, and the browser scrolls to the focused control. That
  // button sits under the photos, so the credits opened at the bottom.
  useLayoutEffect(() => {
    function showTitle() {
      if (panelRef.current) panelRef.current.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    showTitle();
    // Focus can move a frame later, once the player underneath is covered.
    const frame = requestAnimationFrame(showTitle);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-20 overflow-y-auto bg-black text-white"
      role="region"
      aria-label="Credits"
    >
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">{song.title}</h2>
        <p className="mt-3 text-xl">
          <OutboundLink href={song.artistUrl} className="underline underline-offset-4">
            {song.artist}
          </OutboundLink>
        </p>

        {shown.length > 0 && (
          <section className="mt-12" aria-label="Photographs by">
            <h3 className="text-lg font-medium">Photographs by</h3>
            {/* One cell per photo that was on screen, in the order they appeared. */}
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
              {shown.map((photo) => {
                const name = photo.photographer.trim() || "Unknown photographer";
                return (
                  <li key={photo.id} className="min-w-0">
                    <OutboundLink href={photo.pexelsUrl} className="block">
                      {/* Plain img: these files are already on screen.
                          The grid only needs a linked thumbnail. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.src}
                        alt={photo.alt.trim() || `Photo by ${name} on Pexels`}
                        className="aspect-video w-full rounded object-cover"
                      />
                    </OutboundLink>
                    <p className="mt-2 text-sm leading-snug">
                      <OutboundLink
                        href={photo.photographerUrl.trim()}
                        className="underline underline-offset-4"
                      >
                        {name}
                      </OutboundLink>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="mt-12 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPlayAgain}
            className="rounded bg-white px-3 py-2 text-sm font-medium text-black"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onNewSearch}
            className="rounded border border-white/40 px-3 py-2 text-sm"
          >
            New search
          </button>
        </div>

        <footer className="mt-auto pt-16 text-sm leading-relaxed text-white/80">
          <AttributionLink href="https://www.pexels.com">
            Photos provided by Pexels
          </AttributionLink>
          <Separator />
          <AttributionLink href="https://lrclib.net">
            Lyrics from LRCLIB
          </AttributionLink>
          <Separator />
          <AttributionLink href="https://www.deezer.com">
            Search by Deezer
          </AttributionLink>
          <Separator />
          <AttributionLink href="https://open.spotify.com">
            Music on Spotify
          </AttributionLink>
        </footer>
      </div>
    </div>
  );
}

/** Same photo can be reported twice. Keep the first time it appeared. */
function uniquePhotos(photos: Photo[]): Photo[] {
  const seen = new Set<number>();
  const unique: Photo[] = [];
  for (const photo of photos) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    unique.push(photo);
  }
  return unique;
}

/** Opens the musician, photographer, or photo page in a new tab. */
function OutboundLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  if (!href) return <>{children}</>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

function AttributionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function Separator() {
  return <span aria-hidden="true"> · </span>;
}
