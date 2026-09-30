"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Photo, SongPackage, VideoClip } from "@/lib/types";

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
 * Clips that actually played are listed under "Footage by".
 */

export function Credits({
  song,
  photos,
  videos,
  onPlayAgain,
  onNewSearch,
}: {
  song: SongPackage;
  // Photos that really appeared on screen, in the order they appeared.
  photos: Photo[];
  // Clips that really played, in the order they played.
  videos: VideoClip[];
  onPlayAgain: () => void;
  onNewSearch: () => void;
}) {
  const shown = uniquePhotos(photos);
  const footage = uniqueClips(videos);
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
      className="fixed inset-0 z-20 overflow-y-auto bg-[var(--color-bg-black)] [color:var(--color-text-heading)]"
      role="region"
      aria-label="Credits"
    >
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-16">
        <h2 className="[font-size:var(--font-size-credits-song)] [font-weight:var(--font-weight-credits-song)] [line-height:var(--line-height-credits-song)] [letter-spacing:var(--letter-spacing-credits-song)] [color:var(--color-text-heading)]">
          {song.title}
        </h2>
        <p className="mt-3 [font-size:var(--font-size-credits-musician)] [font-weight:var(--font-weight-credits-musician)] [line-height:var(--line-height-credits-musician)] [color:var(--color-text-secondary)]">
          <OutboundLink href={song.artistUrl} className="underline underline-offset-[var(--space-underline-offset)]">
            {song.artist}
          </OutboundLink>
        </p>

        {shown.length > 0 && (
          <section className="mt-12" aria-label="Photographs by">
            <h3 className="[font-size:var(--font-size-credits-heading)] [font-weight:var(--font-weight-credits-heading)] [line-height:var(--line-height-credits-heading)] [letter-spacing:var(--letter-spacing-credits-heading)] [color:var(--color-text-heading)]">
              Photographs by
            </h3>
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
                        className="aspect-video w-full rounded-[var(--radius-tile)] object-cover"
                      />
                    </OutboundLink>
                    <p className="mt-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [line-height:var(--line-height-credits-caption)] [color:var(--color-text-secondary)]">
                      <OutboundLink
                        href={photo.photographerUrl.trim()}
                        className="underline underline-offset-[var(--space-underline-offset)]"
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

        {footage.length > 0 && (
          <section className="mt-12" aria-label="Footage by">
            <h3 className="[font-size:var(--font-size-credits-heading)] [font-weight:var(--font-weight-credits-heading)] [line-height:var(--line-height-credits-heading)] [letter-spacing:var(--letter-spacing-credits-heading)] [color:var(--color-text-heading)]">
              Footage by
            </h3>
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
              {footage.map((clip) => {
                const name = clip.videographer.trim() || "Unknown videographer";
                return (
                  <li key={clip.id} className="min-w-0">
                    <OutboundLink href={clip.pexelsUrl} className="block">
                      {clip.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={clip.poster}
                          alt={`Footage by ${name} on Pexels`}
                          className="aspect-video w-full rounded-[var(--radius-tile)] object-cover"
                        />
                      ) : (
                        <div className="aspect-video w-full rounded-[var(--radius-tile)] bg-[var(--color-credits-tile)]" />
                      )}
                    </OutboundLink>
                    <p className="mt-2 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [line-height:var(--line-height-credits-caption)] [color:var(--color-text-secondary)]">
                      <OutboundLink
                        href={clip.videographerUrl.trim()}
                        className="underline underline-offset-[var(--space-underline-offset)]"
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
            className="rounded-[var(--radius-prompt-button)] bg-[var(--color-button-filled)] px-3 py-2 [font-size:var(--font-size-button-filled)] [font-weight:var(--font-weight-button-filled)] [line-height:var(--line-height-button-filled)] [letter-spacing:var(--letter-spacing-button-filled)] text-[color:var(--color-text-on-selected)] hover:bg-[var(--color-button-filled-hover)]"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onNewSearch}
            className="rounded-[var(--radius-prompt-button)] border-[length:var(--border-width)] border-solid [border-color:var(--color-outline)] bg-transparent px-3 py-2 [font-size:var(--font-size-button-outlined)] [font-weight:var(--font-weight-button-outlined)] [line-height:var(--line-height-button-outlined)] [letter-spacing:var(--letter-spacing-button-outlined)] text-[color:var(--color-text-primary)] hover:bg-[var(--color-hover-outlined)]"
          >
            New search
          </button>
        </div>

        <footer className="mt-auto pt-16 [font-size:var(--font-size-credits-link)] [font-weight:var(--font-weight-credits-link)] [line-height:var(--line-height-credits-link)] [color:var(--color-link)]">
          <AttributionLink href="https://www.pexels.com">
            Photos and videos provided by Pexels
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

/** Same clip can be reported twice. Keep the first time it played. */
function uniqueClips(videos: VideoClip[]): VideoClip[] {
  const seen = new Set<number>();
  const unique: VideoClip[] = [];
  for (const clip of videos) {
    if (seen.has(clip.id)) continue;
    seen.add(clip.id);
    unique.push(clip);
  }
  return unique;
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
      className="underline underline-offset-[var(--space-underline-offset)] hover:[color:var(--color-link-hover)]"
    >
      {children}
    </a>
  );
}

function Separator() {
  return <span aria-hidden="true"> · </span>;
}
