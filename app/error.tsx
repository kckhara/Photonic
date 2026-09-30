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
      <h1 className="[font-size:var(--font-size-credits-heading)] [font-weight:var(--font-weight-credits-heading)] [line-height:var(--line-height-credits-heading)] [color:var(--color-text-heading)]">
        Something went wrong
      </h1>
      <p className="mt-3 [font-size:var(--font-size-credits-caption)] [font-weight:var(--font-weight-credits-caption)] [color:var(--color-text-secondary)]">
        We hit a problem loading this page. Please try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 w-fit rounded-[var(--radius-prompt-button)] border-[length:var(--border-width)] border-solid [border-color:var(--color-outline)] bg-transparent px-3 py-2 [font-size:var(--font-size-button-outlined)] [font-weight:var(--font-weight-button-outlined)] [letter-spacing:var(--letter-spacing-button-outlined)] text-[color:var(--color-text-primary)] hover:bg-[var(--color-hover-outlined)]"
      >
        Try again
      </button>
    </main>
  );
}
