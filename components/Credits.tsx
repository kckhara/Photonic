"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Photo, SongPackage, VideoClip } from "@/lib/types";

/**
 * The screen that appears when a full song finishes.
 *
 * Search stays above this panel, so another song can be chosen from here.
 * The panel names the musician, then every photo and clip that actually
 * played. A picture links to its Pexels page. The name under it links to
 * the photographer or videographer.
 *
 * A 30-second preview does not use this screen.
 */

const BUILT_WITH = [
  {
    label: "Spotify Embeds and iFrame API",
    href: "https://developer.spotify.com/documentation/embeds",
  },
  { label: "LRCLIB", href: "https://lrclib.net" },
  { label: "Pexels", href: "https://www.pexels.com" },
  { label: "Pexels Videos", href: "https://www.pexels.com/videos/" },
] as const;

export function Credits({
  song,
  photos,
  videos,
}: {
  song: SongPackage;
  // Photos that really appeared on screen, in the order they appeared.
  photos: Photo[];
  // Clips that really played, in the order they played.
  videos: VideoClip[];
}) {
  const shown = uniquePhotos(photos);
  const footage = uniqueClips(videos);
  const panelRef = useRef<HTMLDivElement>(null);

  // Open on the song title. A focused control lower on the page would
  // scroll the panel down before anyone has read the name.
  useLayoutEffect(() => {
    function showTitle() {
      if (panelRef.current) panelRef.current.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    showTitle();
    const frame = requestAnimationFrame(showTitle);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={panelRef}
      className="credits"
      role="region"
      aria-label="Credits"
    >
      {/* Opaque black behind the search, so scrolling names don't show
          through the translucent search fill. */}
      <div className="credits-mask" aria-hidden="true" />
      <div className="credits-sheet">
        <h2 className="credits-song">{song.title}</h2>
        <p className="credits-musician">
          <TextLink href={song.artistUrl}>{song.artist}</TextLink>
        </p>

        {shown.length > 0 && (
          <section className="credits-section" aria-labelledby="credits-photos">
            <h3 id="credits-photos" className="credits-heading">
              Photos
            </h3>
            <ul className="credits-grid">
              {shown.map((photo) => {
                const name = photo.photographer.trim() || "Unknown photographer";
                return (
                  <li key={photo.id} className="credits-cell">
                    <OutboundLink
                      href={photo.pexelsUrl}
                      className="credits-tile"
                      label={`Photo by ${name} on Pexels`}
                    >
                      {/* Plain img: these files are already on screen.
                          The grid only needs a linked thumbnail. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.src}
                        alt={photo.alt.trim() || `Photo by ${name} on Pexels`}
                      />
                    </OutboundLink>
                    <p className="credits-caption">
                      <TextLink href={photo.photographerUrl.trim()}>{name}</TextLink>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {footage.length > 0 && (
          <section className="credits-section" aria-labelledby="credits-videos">
            <h3 id="credits-videos" className="credits-heading">
              Videos
            </h3>
            <ul className="credits-grid credits-grid-videos">
              {footage.map((clip) => {
                const name = clip.videographer.trim() || "Unknown videographer";
                return (
                  <li key={clip.id} className="credits-cell">
                    <OutboundLink
                      href={clip.pexelsUrl}
                      className="credits-tile credits-tile-video"
                      label={`Footage by ${name} on Pexels`}
                    >
                      {clip.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={clip.poster} alt={`Footage by ${name} on Pexels`} />
                      ) : null}
                      <span className="credits-play" aria-hidden="true">
                        <PlayIcon />
                      </span>
                    </OutboundLink>
                    <p className="credits-caption">
                      <TextLink href={clip.videographerUrl.trim()}>{name}</TextLink>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="credits-section credits-built" aria-labelledby="credits-built">
          <h3 id="credits-built" className="credits-heading">
            Built with
          </h3>
          <ul className="credits-links">
            {BUILT_WITH.map((item) => (
              <li key={item.href}>
                <a href={item.href} target="_blank" rel="noopener noreferrer">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
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
  label,
  children,
}: {
  href: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  if (!href) return <span className={className}>{children}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label}
    >
      {children}
    </a>
  );
}

/** Name under the title or a tile. Looks like text until hover or focus. */
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  if (!href) return <>{children}</>;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="credits-text-link">
      {children}
    </a>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="credits-play-icon" aria-hidden="true">
      <path d="M9.1 7.15v9.7l8-4.85-8-4.85Z" fill="currentColor" />
    </svg>
  );
}
