"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

/** Drop the address in when the About copy is finished. */
const CONTACT_EMAIL = "";

/**
 * Info button fixed at the top right of every screen.
 * Opens the About dialog.
 */
export function AboutButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    buttonRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="about-button"
        aria-label="About this project"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <InfoIcon />
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    closeRef.current?.focus();

    return () => {
      // Closing here is only for unmount. Don't listen for the close
      // event: in dev, React runs this cleanup once on mount and the
      // event can land after the dialog has opened again.
      if (dialog.open) dialog.close();
    };
  }, []);

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby="about-title"
      onClick={onDialogClick}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="about-title" className="about-dialog-title">
        About
      </h2>
      <div className="about-dialog-body">
        <p>
          [Why you made this project, and what you hope people feel when they
          watch a song play out.]
        </p>
        <p>
          [How it works in a sentence or two, and anything you want to credit
          or thank.]
        </p>
      </div>
      <hr className="about-dialog-rule" />
      <a className="about-contact" href={`mailto:${CONTACT_EMAIL}`}>
        <EnvelopeIcon />
        <span>Contact me</span>
      </a>
      <button
        ref={closeRef}
        type="button"
        className="about-close"
        aria-label="Close"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </dialog>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-about-icon)]"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
      />
      <path
        d="M12 11.2v5.3"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke)"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.6" r="1.05" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
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

function EnvelopeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[var(--space-icon)]"
      fill="none"
    >
      <rect
        x="3.4"
        y="5.4"
        width="17.2"
        height="13.2"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke-fine)"
      />
      <path
        d="M4.2 7.1 12 12.4 19.8 7.1"
        stroke="currentColor"
        strokeWidth="var(--space-icon-stroke-fine)"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
