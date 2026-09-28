"use client";

import { useEffect, useRef, useState } from "react";
import { NoLyricsMessage, NO_LYRICS_MESSAGE_MS } from "@/components/NoLyricsMessage";
import { PlayerBar } from "@/components/PlayerBar";
import { SearchBox } from "@/components/SearchBox";
import { Visualizer } from "@/components/Visualizer";
import type { SearchHit } from "@/lib/deezer";
import type { Photo, PlaybackSample, SongPackage } from "@/lib/types";

/**
 * Homepage: search, then the player, with photos filling the screen behind them.
 * This file runs in the browser because it has to remember the chosen song.
 */
export default function Home() {
  // pickId changes on every choice, even the same row twice, so the player
  // starts that request from scratch instead of keeping the previous song.
  const nextPickId = useRef(0);
  // Photos that really appeared on screen. The credits screen will read this later.
  const shownPhotosRef = useRef<Photo[]>([]);

  const [pick, setPick] = useState<{
    hit: SearchHit;
    pickId: number;
  } | null>(null);
  const [song, setSong] = useState<SongPackage | null>(null);
  const [playback, setPlayback] = useState<PlaybackSample | null>(null);
  // True while the no-lyrics sentence is up. Photos wait until it ends.
  const [holdPhotos, setHoldPhotos] = useState(false);
  const noLyricsTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => clearNoLyricsTimer();
  }, []);

  function clearNoLyricsTimer() {
    if (noLyricsTimer.current == null) return;
    window.clearTimeout(noLyricsTimer.current);
    noLyricsTimer.current = null;
  }

  function onSelect(hit: SearchHit) {
    nextPickId.current += 1;
    clearNoLyricsTimer();
    setHoldPhotos(false);
    setPick({ hit, pickId: nextPickId.current });
    setSong(null);
    setPlayback(null);
    shownPhotosRef.current = [];
  }

  function onSong(next: SongPackage | null) {
    setSong(next);
    clearNoLyricsTimer();

    // No words, but we do have photos: show the sentence, then the photos.
    // If the photos failed too, skip the sentence — the player explains that.
    const showSentence =
      next != null &&
      next.lyricsType === "none" &&
      next.scenes.some((scene) => scene.photos.length > 0);

    if (!showSentence) {
      setHoldPhotos(false);
      return;
    }

    setHoldPhotos(true);
    noLyricsTimer.current = window.setTimeout(() => {
      noLyricsTimer.current = null;
      setHoldPhotos(false);
    }, NO_LYRICS_MESSAGE_MS);
  }

  function onShownPhotos(photos: Photo[]) {
    shownPhotosRef.current = photos;
  }

  // White words need a dark full-screen behind them. That's the photos,
  // the opening title card, or the black screen under the no-lyrics sentence.
  // A failed load has none of those, so the words stay the normal color.
  const hasPhotos = song?.scenes.some((scene) => scene.photos.length > 0) ?? false;
  const darkScreen =
    holdPhotos || (song != null && (song.lyricsType !== "none" || hasPhotos));

  return (
    <div className="relative min-h-screen">
      <Visualizer
        key={pick?.pickId ?? 0}
        song={song}
        playback={playback}
        holdPhotos={holdPhotos}
        onShownPhotos={onShownPhotos}
      />
      {/* A light darkening, stronger near the words, so the photo stays
          visible and the search text can still be read on top of it. */}
      {darkScreen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1] bg-gradient-to-b from-black/70 via-black/20 to-black/30"
        />
      )}
      <main
        className={`relative z-10 mx-auto flex w-full max-w-xl flex-col px-6 py-16 ${
          darkScreen ? "text-white" : ""
        }`}
      >
        <h1 className="mb-6 text-2xl font-semibold">Lyric Visualizer</h1>
        <SearchBox onSelect={onSelect} />
        {holdPhotos && (
          <div className="mt-10">
            <NoLyricsMessage />
          </div>
        )}
        {pick && (
          <PlayerBar
            key={pick.pickId}
            selection={pick.hit}
            onSong={onSong}
            onPlayback={setPlayback}
          />
        )}
      </main>
    </div>
  );
}
