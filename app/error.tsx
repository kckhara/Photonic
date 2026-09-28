"use client";

import { useEffect } from "react";

/**
 * Last resort if the page itself crashes.
 * Shows a short message instead of a blank screen.
 * The details are printed for debugging — they are not shown here,
 * because they can be technical.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-sm">
        We hit a problem loading this page. Please try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 w-fit rounded border border-foreground/30 px-3 py-2 text-sm"
      >
        Try again
      </button>
    </main>
  );
}
