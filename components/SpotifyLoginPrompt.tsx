/**
 * The small Spotify login panel (plan section 5.6).
 *
 * It sits near the player and does not cover the photos.
 * Three moments:
 * - While a preview is playing: invite them to log in, or dismiss.
 * - After they open Spotify's login page: ask them to reload the player.
 * - When the 30-second clip ends: this panel, not the credits screen.
 *
 * "Log in" opens Spotify's public login page in a new tab.
 * Our code never sees their password or an API key.
 */

export type LoginPromptStep = "invite" | "reload" | "ended";

const LOGIN_URL = "https://accounts.spotify.com/login";

export function SpotifyLoginPrompt({
  step,
  onLogin,
  onMaybeLater,
  onReload,
  onPlayAgain,
  onNewSearch,
}: {
  step: LoginPromptStep;
  // Called when they follow the login link, so the panel can
  // switch to the "Reload player" step.
  onLogin: () => void;
  onMaybeLater: () => void;
  onReload: () => void;
  onPlayAgain: () => void;
  onNewSearch: () => void;
}) {
  return (
    <section
      aria-label="Spotify login"
      className="max-w-md rounded-[var(--radius-prompt)] border-[length:var(--border-width)] border-solid [border-color:var(--color-border-prompt)] bg-[var(--color-prompt-surface)] p-4 [color:var(--color-text-primary)] shadow-[var(--shadow-overlay)] [backdrop-filter:blur(var(--blur-prompt))]"
    >
      {step === "reload" ? (
        <ReloadStep onReload={onReload} onMaybeLater={onMaybeLater} />
      ) : step === "ended" ? (
        <EndedStep
          onLogin={onLogin}
          onPlayAgain={onPlayAgain}
          onNewSearch={onNewSearch}
        />
      ) : (
        <InviteStep onLogin={onLogin} onMaybeLater={onMaybeLater} />
      )}
    </section>
  );
}

function InviteStep({
  onLogin,
  onMaybeLater,
}: {
  onLogin: () => void;
  onMaybeLater: () => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="[font-size:var(--font-size-prompt-title)] [font-weight:var(--font-weight-prompt-title)] [line-height:var(--line-height-prompt-title)] [letter-spacing:var(--letter-spacing-prompt-title)] [color:var(--color-text-heading)]">
        Hearing a 30-second preview?
      </h2>
      <p className="[font-size:var(--font-size-prompt-body)] [font-weight:var(--font-weight-prompt-body)] [line-height:var(--line-height-prompt-body)] [letter-spacing:var(--letter-spacing-prompt-body)] [color:var(--color-text-primary)]">
        For the full experience, log in to Spotify Premium in this browser to
        hear full songs.
      </p>
      <div className="flex flex-wrap gap-2">
        <LoginLink onLogin={onLogin} />
        <SecondaryButton onClick={onMaybeLater}>Maybe later</SecondaryButton>
      </div>
    </div>
  );
}

function ReloadStep({
  onReload,
  onMaybeLater,
}: {
  onReload: () => void;
  onMaybeLater: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="[font-size:var(--font-size-prompt-body)] [font-weight:var(--font-weight-prompt-body)] [line-height:var(--line-height-prompt-body)] [color:var(--color-text-primary)]">
        Logged in?
      </p>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton onClick={onReload}>Reload player</PrimaryButton>
        <SecondaryButton onClick={onMaybeLater}>Maybe later</SecondaryButton>
      </div>
    </div>
  );
}

function EndedStep({
  onLogin,
  onPlayAgain,
  onNewSearch,
}: {
  onLogin: () => void;
  onPlayAgain: () => void;
  onNewSearch: () => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="[font-size:var(--font-size-prompt-title)] [font-weight:var(--font-weight-prompt-title)] [line-height:var(--line-height-prompt-title)] [letter-spacing:var(--letter-spacing-prompt-title)] [color:var(--color-text-heading)]">
        That was the preview — for the full experience, log in to hear the
        whole song.
      </h2>
      <div className="flex flex-wrap gap-2">
        <LoginLink onLogin={onLogin} />
        <SecondaryButton onClick={onPlayAgain}>Play again</SecondaryButton>
        <SecondaryButton onClick={onNewSearch}>New search</SecondaryButton>
      </div>
    </div>
  );
}

/** Spotify's login page, in a new tab. Our site stays open. */
function LoginLink({ onLogin }: { onLogin: () => void }) {
  return (
    <a
      href={LOGIN_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onLogin}
      className="inline-block rounded-[var(--radius-prompt-button)] bg-[var(--color-button-filled)] px-3 py-2 [font-size:var(--font-size-button-filled)] [font-weight:var(--font-weight-button-filled)] [line-height:var(--line-height-button-filled)] [letter-spacing:var(--letter-spacing-button-filled)] text-[color:var(--color-text-on-selected)] hover:bg-[var(--color-button-filled-hover)]"
    >
      Log in to Spotify
    </a>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-prompt-button)] bg-[var(--color-button-filled)] px-3 py-2 [font-size:var(--font-size-button-filled)] [font-weight:var(--font-weight-button-filled)] [line-height:var(--line-height-button-filled)] [letter-spacing:var(--letter-spacing-button-filled)] text-[color:var(--color-text-on-selected)] hover:bg-[var(--color-button-filled-hover)]"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-prompt-button)] border-[length:var(--border-width)] border-solid [border-color:var(--color-outline)] bg-transparent px-3 py-2 [font-size:var(--font-size-button-outlined)] [font-weight:var(--font-weight-button-outlined)] [line-height:var(--line-height-button-outlined)] [letter-spacing:var(--letter-spacing-button-outlined)] text-[color:var(--color-text-primary)] hover:bg-[var(--color-hover-outlined)]"
    >
      {children}
    </button>
  );
}
