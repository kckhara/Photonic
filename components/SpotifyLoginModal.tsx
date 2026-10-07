"use client";

import { useEffect, useRef, type MouseEvent } from "react";

const SPOTIFY_LOGIN_URL = "https://accounts.spotify.com/login";

/**
 * Shown when Spotify will only play a preview. They can log in, or
 * close this and keep the preview.
 */
export function SpotifyLoginModal({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loginRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    loginRef.current?.focus();

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
      className="login-dialog"
      aria-labelledby="spotify-login-message"
      onClick={onDialogClick}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <p id="spotify-login-message" className="login-dialog-copy">
        In order to see images and hear the whole song, please log in to your
        Spotify account.
      </p>
      <a
        ref={loginRef}
        className="login-dialog-action"
        href={SPOTIFY_LOGIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onLogin}
      >
        Log in to Spotify
      </a>
      <button type="button" className="login-dialog-close" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
