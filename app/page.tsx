"use client";

import { useRef, useState } from "react";
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

  function onSelect(hit: SearchHit) {
    nextPickId.current += 1;
    setPick({ hit, pickId: nextPickId.current });
    setSong(null);
    setPlayback(null);
    shownPhotosRef.current = [];
  }

  function onShownPhotos(photos: Photo[]) {
    shownPhotosRef.current = photos;
  }

  return (
    <div className="relative min-h-screen">
      <Visualizer
        key={pick?.pickId ?? 0}
        song={song}
        playback={playback}
        onShownPhotos={onShownPhotos}
      />
      {/* A light darkening, stronger near the words, so the photo stays
          visible and the search text can still be read on top of it. */}
      {song && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1] bg-gradient-to-b from-black/70 via-black/20 to-black/30"
        />
      )}
      <main
        className={`relative z-10 mx-auto flex w-full max-w-xl flex-col px-6 py-16 ${
          song ? "text-white" : ""
        }`}
      >
        <h1 className="mb-6 text-2xl font-semibold">Lyric Visualizer</h1>
        <SearchBox onSelect={onSelect} />
        {pick && (
          <PlayerBar
            key={pick.pickId}
            selection={pick.hit}
            onSong={setSong}
            onPlayback={setPlayback}
          />
        )}
      </main>
    </div>
  );
}
