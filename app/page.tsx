import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Lyric Visualizer</h1>
      <SearchBox />
    </main>
  );
}
