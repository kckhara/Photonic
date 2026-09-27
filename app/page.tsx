"use client";

import { useRef, useState } from "react";
import { PlayerBar } from "@/components/PlayerBar";
import { SearchBox } from "@/components/SearchBox";
import type { SearchHit } from "@/lib/deezer";

/**
 * Homepage: search box, then the player once a song or musician is chosen.
 * This file runs in the browser because it has to remember that choice.
 */
export default function Home() {
  // pickId changes on every choice, even the same row twice, so the player
  // starts that request from scratch instead of keeping the previous song.
  const nextPickId = useRef(0);
  const [pick, setPick] = useState<{
    hit: SearchHit;
    pickId: number;
  } | null>(null);

  function onSelect(hit: SearchHit) {
    nextPickId.current += 1;
    setPick({ hit, pickId: nextPickId.current });
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Lyric Visualizer</h1>
      <SearchBox onSelect={onSelect} />
      {pick && <PlayerBar key={pick.pickId} selection={pick.hit} />}
    </main>
  );
}
