# Lyric Visualizer — Build Plan

A web app that plays a song and turns its lyrics into a full-screen, tempo-synced sequence of photographs, then ends with a credits screen for the musician and every photographer shown.

This document is the single source of truth for the build. Keep it in the root of the project. When prompting Cursor, reference it with `@PLAN.md` so it follows the same decisions every time.

---

## 1. How to use this document (read first)

- **Work one phase at a time.** Each phase has a goal, a prompt to give Cursor, and a "check it works" list. Don't start the next phase until the current one passes its checks.
- **Save your progress after every phase** (a "commit" — see Section 9). If something breaks later, you can always go back.
- **Keep prompts small.** If Cursor tries to build three phases at once, stop it and point it back to the current phase.
- **When something errors,** copy the full error message into Cursor and ask it to explain the problem in plain language before fixing it.
- **Rules for Cursor** (paste this at the start of a new Cursor chat):

  > Read @PLAN.md. I'm a designer with no engineering background, building this step by step. Only work on the phase I name. Explain what you're changing in plain language before changing it. Keep code simple and well-commented. Never put API keys in frontend code or commit them to git. Use the stack and folder structure in the plan; ask me before adding any new library or service.

---

## 2. What the user experiences

1. Lands on the homepage and sees a search box.
2. Types a song or musician. Results appear in a dropdown as they type (after 2+ characters).
3. Picks a song or a musician from the dropdown.
   - **Song:** that song plays.
   - **Musician:** their most popular song plays. *(Assumption — confirm.)*
4. The song starts playing. Minimal player controls sit below the search bar.
   - **If the listener isn't logged in to Spotify** (so they're only hearing a 30-second preview), a prompt invites them to log in for full songs. A "Log in to Spotify" link opens Spotify's login page in a new tab. They can choose "Maybe later" to dismiss it, and a small "Log in for full songs" link stays in the player bar so they can come back to it anytime. See Section 5.6.
5. Full-screen photos appear, chosen from keywords in the lyrics, changing in time with the song's tempo.
6. If no lyrics exist, a message shows — "We can't find lyrics, but let's see what happens" — then random photos play at the song's tempo.
7. Play, pause, rewind, and fast-forward all work, and the photos stay in sync.
8. When the song ends, a credits screen lists the musician and every photographer shown, each linking out.

Desktop first; responsive where practical.

---

## 3. Tech stack

| Job | Choice | Why | Needs a key? |
|---|---|---|---|
| Website framework | **Next.js** (with TypeScript) | Handles both the pages and the small server functions that hide API keys. Very well supported by Cursor. | — |
| Styling | **Tailwind CSS** | Styles live next to the markup, which makes applying your designs fast. | — |
| Hosting | **Vercel** | Connects to GitHub. Every time you save to GitHub, the site updates automatically. Free tier is enough. | Account |
| Code storage | **GitHub** | Stores the code and its history. | Account (you have one) |
| Search | **Deezer API** | Free, no key, returns songs, artists, album art, tempo (BPM), and a universal song ID (ISRC). | No |
| Playback | **Spotify Embed + iFrame API** | Spotify's official embeddable player, controllable from our code, reports the playback position. | No |
| Deezer → Spotify matching | **Spotify Web API (search by ISRC only)** | Turns the Deezer song into the matching Spotify song so the player can load it. Runs on our server with app-only login. | Yes (Spotify developer app) |
| Lyrics | **LRCLIB** | Free, no key, time-stamped ("synced") lyrics. | No |
| Tempo | **Deezer** (`bpm` field), default of 120 if missing | Already in the Deezer data we fetch. | No |
| Keyword extraction | **compromise** (small JavaScript language library) + a stop-word list | Pulls out the meaningful words (mostly nouns) and drops "a, and, the". Runs for free inside our code. | No |
| Photos | **Pexels API** | Free, instant key, returns photographer name and profile link for credits. | Yes (Pexels) |
| Caching | **Next.js built-in fetch caching** | Saves API results so repeated songs don't use up rate limits. No database needed for v1. | — |

### Known limitations (decided, not bugs)

- **Full songs need Spotify Premium.** The Spotify player only plays full tracks for listeners logged in to Spotify Premium in that browser. Everyone else hears a 30-second preview. The login prompt (Section 5.6) helps logged-out Premium users; free-account users will still hear previews even after logging in. Fine for you and a few friends; revisit before a wider launch.
- **We can't directly ask Spotify whether someone is logged in.** The player runs on Spotify's site, not ours, so login status isn't shared with our code. We detect preview mode indirectly instead (Section 5.6).
- **Your Spotify developer app requires you to have Spotify Premium.** If your Premium lapses, the Deezer → Spotify matching stops working.
- **"Immediately plays" may need one click.** Browsers restrict audio that starts without a click. Selecting a result counts as a click on *our* page, but the Spotify player is embedded from Spotify's site, so some browsers may still require the user to press play once. Test in Phase 1.
- **Deezer's API is for non-commercial use.** No ads or paid tier while using it.
- **Pexels is limited to 200 requests/hour.** Caching and a per-song cap on keywords (Section 5) keep us well under.
- **Lyrics are used, not displayed.** They drive image selection only, which keeps us clear of lyric copyright issues.

---

## 4. How the pieces connect

```
Browser (what the user sees)                  Our server (Next.js API routes, hides keys)
─────────────────────────────                 ─────────────────────────────────────────────
Search box ── types ──────────────────────▶   /api/search?q=...        ──▶ Deezer search
   ◀──────────── dropdown results ───────
User picks a song / artist ───────────────▶   /api/song/[deezerId]
                                                 1. Deezer track details (title, artist,
                                                    duration, bpm, isrc)
                                                 2. Spotify: find track by ISRC
                                                 3. LRCLIB: synced lyrics
                                                 4. Extract keywords per lyric line
                                                 5. Pexels: photos for each keyword
   ◀──────────── one "song package" ─────        (every step cached)
Spotify player loads spotifyId, plays
Visual engine: reads playback position ──▶ picks scene + photo ──▶ full-screen crossfade
Song ends ──▶ Credits screen (musician + photographers shown)
```

**The single most important idea:** the photos on screen are always calculated from the *current playback position*, never from a separate timer. That's what makes pause, rewind and fast-forward stay in sync automatically.

---

## 5. Core logic

### 5.1 The song package (returned by `/api/song/[deezerId]`)

```ts
type Photo = {
  id: number;
  src: string;              // large image URL from Pexels
  alt: string;
  avgColor: string;         // Pexels provides this; use as a placeholder while loading
  photographer: string;
  photographerUrl: string;
  pexelsUrl: string;        // the photo's page on Pexels
};

type Scene = {
  startMs: number;          // when this scene begins in the song
  endMs: number;
  keyword: string;
  photos: Photo[];          // 2–3 photos for this keyword
};

type SongPackage = {
  deezerId: number;
  spotifyId: string | null; // null = no Spotify match found
  title: string;
  artist: string;
  artistUrl: string;        // Deezer artist page for credits
  durationMs: number;
  bpm: number;              // cleaned-up tempo (see 5.4)
  lyricsType: "synced" | "plain" | "none";
  scenes: Scene[];
};
```

### 5.2 From lyrics to scenes

1. Fetch lyrics from LRCLIB using title, artist, album and duration (`/api/get`). If that misses, try LRCLIB search (`/api/search`) and pick the closest duration match.
2. **Synced lyrics:** each line has a timestamp. For each line, extract keywords:
   - Use `compromise` to take nouns first, then strong adjectives/verbs if a line has no nouns.
   - Remove stop words (a, and, the, I, you, it, oh, yeah, baby, etc. — keep the list in one file so it's easy to edit).
   - Keep 1 keyword per line (the most "visual" one — nouns win).
3. **Plain lyrics (no timestamps):** extract keywords the same way, then spread them evenly across the song's duration.
4. **No lyrics / instrumental:** no keyword scenes. Use Pexels "curated" (random) photos spread across the song.
5. Merge consecutive lines with the same keyword into one scene.
6. **Cap at ~20 unique keywords per song** to stay within Pexels limits. If there are more, keep the most frequent.
7. For each unique keyword, fetch 3 landscape photos from Pexels. Reuse photos if a keyword repeats (e.g. the chorus).

### 5.3 The visual engine (runs in the browser)

- The Spotify player reports its position about once a second. Between updates, estimate the position smoothly using the time elapsed since the last update (only while playing).
- On every animation frame:
  1. Find the scene whose `startMs ≤ position < endMs`.
  2. Pick the photo within that scene: `photoIndex = floor((position − scene.startMs) / imageIntervalMs) % scene.photos.length`.
  3. If it's different from what's on screen, crossfade to it.
- **Scene changes happen exactly at lyric timestamps.** Within a scene, photos change on the beat grid.
- Preload the next 3 photos ahead of time so nothing pops in late.
- Record every photo that's actually displayed (for the credits).

### 5.4 Tempo rules

- `beatMs = 60000 / bpm`
- **Clean up bad tempo data:** if bpm is missing or 0, use 120. If above 170, halve it. If below 70, double it.
- **Photo change interval:** every 4 beats (one bar) by default. Slow songs (< 90 bpm) every 8 beats.
- **Transition style:** crossfade duration = 1 beat, capped between 150ms and 1200ms. Slow songs get long dissolves; fast songs get quick fades.
- Optional polish: a slow zoom on each photo, lasting the photo's time on screen.

### 5.5 End of song → credits

- The Spotify iFrame API has no dedicated "finished" event. Treat the song as ended when the position is within 1 second of the duration and playback has paused (or the position jumps back to 0 right after being near the end).
- Credits screen:
  - Song title + musician (links to their page)
  - "Photographs by" — every photographer whose photo was displayed, each linking to their Pexels profile, with the photo linking to its Pexels page
  - Footer: "Photos provided by Pexels · Lyrics from LRCLIB · Search by Deezer · Music on Spotify"
  - Buttons: "Play again" and "New search"
- **Don't show credits when a 30-second preview ends** — show the login prompt instead (Section 5.6).

### 5.6 Spotify login prompt (preview mode)

**Detecting preview mode.** Once playback starts, compare the `duration` reported by the Spotify player's `playback_update` with the song's real duration from Deezer. If Spotify reports roughly 30 seconds (under 35,000ms) and the real song is longer, the listener is hearing a preview → treat them as not logged in (or not Premium).

**The prompt.**
- A small, non-blocking panel near the player (not a full-screen popup — the photos keep playing behind it):
  - Heading: "Hearing a 30-second preview?"
  - Body: "Log in to Spotify Premium in this browser to hear full songs."
  - Primary button: **Log in to Spotify** → opens `https://accounts.spotify.com/login` in a new tab (`target="_blank"`, `rel="noopener noreferrer"`). If they're already logged in there, Spotify simply shows they're logged in.
  - Secondary button: **Maybe later** → dismisses the prompt.
- After they click "Log in to Spotify", the panel changes to: "Logged in? **Reload player**" plus "Maybe later". "Reload player" re-creates the Spotify player with the same song and position so it picks up the new login, then re-checks for preview mode.
- **Skipping:** "Maybe later" hides the prompt for the rest of the visit (remember it in the browser's session storage). It doesn't reappear on every song.
- **Coming back later:** while preview mode is detected, a small "Log in for full songs" link stays in the player bar. Clicking it reopens the prompt.
- **When the preview ends:** show a short version of the prompt ("That was the preview — log in to hear the whole song") with **Log in to Spotify**, **Play again**, and **New search**, instead of the credits screen.

**Visuals in preview mode.** Spotify's preview is a 30-second clip, often from the middle of the song, and the reported position counts from the start of the clip, not the start of the song. So lyric timestamps can't be matched reliably. In preview mode, use the "no lyrics" behavior: curated or keyword photos changing on the beat, without lyric-timed scene changes. (Don't show the "We can't find lyrics" message — the login prompt covers it.)

---

## 6. API reference (for Cursor)

All external calls happen in server routes under `app/api/`, never directly from the browser.

**Deezer** (no key)
- Search songs: `GET https://api.deezer.com/search?q={query}&limit=6`
- Search artists: `GET https://api.deezer.com/search/artist?q={query}&limit=3`
- Track details (includes `bpm`, `isrc`, `duration`): `GET https://api.deezer.com/track/{id}`
- Artist's top song: `GET https://api.deezer.com/artist/{id}/top?limit=1`

**Spotify** (server only, app-only login)
- Get a token: `POST https://accounts.spotify.com/api/token` with `grant_type=client_credentials` and the client ID + secret. Tokens expire after about an hour — cache and refresh.
- Find by ISRC: `GET https://api.spotify.com/v1/search?q=isrc:{ISRC}&type=track&limit=1`
- Player (browser): load `https://open.spotify.com/embed/iframe-api/v1`, then use `IFrameAPI.createController(element, { uri: "spotify:track:{id}" }, callback)`. Controller methods: `play()`, `pause()`, `resume()`, `togglePlay()`, `seek(seconds)`, `loadUri(uri)`. Listen for `playback_update` → `{ isPaused, isBuffering, duration, position }` (milliseconds).

**LRCLIB** (no key; must send a `User-Agent` header naming the app, version and a contact link)
- Exact match: `GET https://lrclib.net/api/get?track_name=&artist_name=&album_name=&duration={seconds}`
- Search: `GET https://lrclib.net/api/search?track_name=&artist_name=`
- Response includes `syncedLyrics` (format `[mm:ss.xx] line`), `plainLyrics`, `instrumental`.

**Pexels** (key in `Authorization` header)
- Search: `GET https://api.pexels.com/v1/search?query={keyword}&per_page=3&orientation=landscape`
- Random/curated: `GET https://api.pexels.com/v1/curated?per_page=20`
- Photo fields used: `id`, `src.large2x`, `alt`, `avg_color`, `photographer`, `photographer_url`, `url`

**Environment variables** (stored in `.env.local` on your computer and in Vercel's settings — never in GitHub)
```
PEXELS_API_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
LRCLIB_USER_AGENT="LyricVisualizer/0.1 (https://your-site-or-github-link)"
```

---

## 7. Folder structure

```
/app
  page.tsx                 ← homepage: search + player + visuals + credits
  /api
    /search/route.ts       ← Deezer search (songs + artists)
    /artist-top/[id]/route.ts ← an artist's top song
    /song/[id]/route.ts    ← builds the full song package
/components
  SearchBox.tsx
  PlayerBar.tsx            ← Spotify embed + our minimal controls
  Visualizer.tsx           ← full-screen photo engine
  NoLyricsMessage.tsx
  SpotifyLoginPrompt.tsx   ← preview-mode prompt (Section 5.6)
  Credits.tsx
/lib
  deezer.ts
  spotify.ts
  lrclib.ts
  pexels.ts
  keywords.ts              ← keyword extraction + stop words
  scenes.ts                ← lyrics → scenes
  tempo.ts                 ← bpm clean-up + intervals
  types.ts                 ← the types in Section 5.1
PLAN.md                    ← this file
.env.local                 ← your keys (never committed)
```

---

## 8. Build phases

### Phase 0 — Set up your tools (one-time)

**Goal:** a blank site running on your computer and live on the internet.

1. **Install** Cursor, and **Node.js (LTS version)** from nodejs.org.
2. **Check Git is installed:** in Cursor, open the terminal (View → Terminal) and type `git --version`. On a Mac, if it isn't installed, a prompt will offer to install it — accept.
3. **Create accounts / keys:**
   - **Vercel** — sign up with your GitHub account.
   - **Pexels** — create an account, then request an API key at pexels.com/api (instant).
   - **Spotify developer app** — requires Spotify Premium. Go to developer.spotify.com → Dashboard → Create app. Name it anything, and set the Redirect URI to `http://127.0.0.1:3000/callback` (required by the form; we won't use it). Choose "Web API". Copy the Client ID and Client Secret.
4. **Create the project.** In Cursor's terminal, go to a folder where you keep projects and run:
   `npx create-next-app@latest lyric-visualizer`
   When asked, accept the recommended defaults, making sure **TypeScript**, **Tailwind CSS** and **App Router** are "Yes".
5. **Open the new folder in Cursor** (File → Open Folder). Put this `PLAN.md` file in the root.
6. **Run it locally:** in the terminal, `npm run dev`, then open `http://localhost:3000`. You should see the Next.js starter page.
7. **Put it on GitHub:** in Cursor's Source Control panel (left sidebar), click "Publish to GitHub" and choose a private repository.
8. **Deploy:** in Vercel, "Add New → Project", pick the repository, click Deploy. You now have a live URL.
9. **Add your keys:** create `.env.local` in the project root with the variables from Section 6. Then add the same variables in Vercel → Project → Settings → Environment Variables, and redeploy.

✅ **Check:** the starter page shows on localhost and at your Vercel URL. `.env.local` does **not** appear in GitHub.

### Phase 1 — Prove the risky parts first

**Goal:** confirm the Spotify pieces work before building anything that depends on them.

> **Prompt:** "Phase 1 of @PLAN.md. Create a temporary test page at /test. It should (1) embed the Spotify player using the iFrame API for a hard-coded track, show the live `playback_update` position on screen, and have my own Play/Pause/−10s/+10s buttons that control it; and (2) have a server route that takes an ISRC, gets a Spotify app token with client credentials, and returns the matching Spotify track ID. Show that result on the test page for a hard-coded ISRC."

✅ **Check:**
- Logged into Spotify Premium in the browser, the full song plays (not a 30-second preview).
- Position updates on screen; your buttons pause, resume, and seek.
- Note whether playback starts from your button without clicking inside the Spotify player. (This tells us how "immediate" play can be.)
- The ISRC lookup returns a Spotify ID.
- Open the test page in a private/incognito window (not logged in to Spotify). Confirm a preview plays and note the `duration` the player reports — it should be about 30,000ms. This is how Section 5.6 detects preview mode.

If anything here fails, stop and bring the result back to Claude — the plan may need adjusting before going further.

### Phase 2 — Search

> **Prompt:** "Phase 2 of @PLAN.md. Build `/api/search` using Deezer (songs + artists) and a `SearchBox` component on the homepage. Search after 2+ characters with a 250ms pause, show songs and artists in separate groups in a dropdown with small artwork, support arrow keys + Enter, and log the selected item to the console for now. Keep styling plain — designs come later."

✅ **Check:** typing "radiohe" shows Radiohead and their songs. Results update smoothly; picking one logs it.

### Phase 3 — The song package

> **Prompt:** "Phase 3 of @PLAN.md. Build `/api/song/[id]` and `/api/artist-top/[id]`. The song route should gather Deezer track details, the Spotify ID via ISRC, and LRCLIB lyrics (with the fallback search), then return title, artist, duration, cleaned bpm, spotifyId and lyricsType. Don't do keywords or photos yet. Cache results for 24 hours. Add a /debug page where I can enter a Deezer ID and see the JSON."

✅ **Check:** try 5 songs you know well, including one instrumental. Tempo looks sensible, the Spotify ID is found, and lyrics type is correct.

### Phase 4 — Player on the homepage

> **Prompt:** "Phase 4 of @PLAN.md. When I select a song (or an artist, using their top song), fetch the song package and load the Spotify player in a compact `PlayerBar` below the search bar with Play/Pause, −10s and +10s controls. Try to start playback immediately. If no Spotify match exists, show a friendly message."

✅ **Check:** search → select → music plays. Controls work. Selecting a musician plays their top song.

### Phase 5 — Keywords and photos

> **Prompt:** "Phase 5 of @PLAN.md. Implement `keywords.ts`, `scenes.ts` and `pexels.ts` following Section 5.2, and add the scenes (with photos) to the song package. Cap at 20 unique keywords, 3 landscape photos each, cache Pexels results for 24 hours. Show the scenes (time, keyword, thumbnails) on the /debug page."

✅ **Check:** on /debug, keywords look like real things ("rain", "city", "fire"), not filler words. Photos roughly match. Edit the stop-word list if junk words slip through.

### Phase 6 — The visual engine

> **Prompt:** "Phase 6 of @PLAN.md. Build `Visualizer` following Sections 5.3 and 5.4: full-screen photos behind the search bar and player, chosen from the current playback position, smooth position estimation between updates, beat-based photo changes, tempo-based crossfades, and preloading of the next 3 photos. Keep a list of photos actually shown."

✅ **Check:** photos change on the lyrics and roughly on the beat. Pause freezes the image. Rewinding and skipping jump to the right photos. No blank flashes between photos.

### Phase 7 — Fallbacks

> **Prompt:** "Phase 7 of @PLAN.md. Handle: (1) no lyrics → show 'We can't find lyrics, but let's see what happens' for ~3 seconds, then curated photos at tempo; (2) plain-only lyrics → keywords spread evenly; (3) missing bpm → 120; (4) any API failure → a friendly message instead of a broken screen."

✅ **Check:** an instrumental shows the message and then photos. Temporarily breaking the Pexels key shows a friendly error, not a crash.

### Phase 8 — Spotify login prompt

> **Prompt:** "Phase 8 of @PLAN.md. Implement the Spotify login prompt exactly as described in Section 5.6: preview-mode detection, the non-blocking prompt with 'Log in to Spotify' (new tab) and 'Maybe later', the 'Reload player' step after login, the persistent 'Log in for full songs' link in the player bar, the end-of-preview prompt, and beat-only visuals while in preview mode."

✅ **Check:**
- In a private window (logged out), the prompt appears shortly after playback starts.
- "Log in to Spotify" opens Spotify's login in a new tab; after logging in with Premium, "Reload player" plays the full song and the prompt disappears.
- "Maybe later" hides the prompt, it stays hidden on the next song, and the "Log in for full songs" link reopens it.
- When a preview ends, you see the end-of-preview prompt, not the credits.
- Logged in with Premium in your normal browser, you never see the prompt.

### Phase 9 — Credits

> **Prompt:** "Phase 9 of @PLAN.md. Detect the end of the song (Section 5.5) and show the `Credits` screen with the musician and every photographer whose photo was displayed, linking to their Pexels profiles, plus the footer attributions and Play again / New search buttons."

✅ **Check:** let a song finish. Every photographer appears once, and all links open the correct pages in a new tab.

### Phase 10 — Apply your designs

Design the screens in Claude Design: search (empty and with results), playing, no-lyrics message, Spotify login prompt (including the "Reload player" and end-of-preview states), credits, loading and error states. Then apply one screen per prompt:

> **Prompt:** "Phase 10 of @PLAN.md. Restyle the [screen name] to match this design [attach image/link]. Only change styling and layout, not behavior. Use Tailwind. Make it work down to tablet width."

✅ **Check:** each screen matches the design and nothing that worked before is broken.

### Phase 11 — Launch

1. Remove the /test and /debug pages (or hide them).
2. Test the full flow in Chrome, Safari and Firefox.
3. **Custom domain:** when you buy one, add it in Vercel → Project → Settings → Domains and follow the instructions it shows for your domain provider.
4. Update `LRCLIB_USER_AGENT` to include your new domain.

✅ **Check:** friends can open the URL, search, and watch a song end to end.

### Later ideas (not v1)

- Use an AI model to turn each lyric line into a better image search ("cold as ice" → frozen landscape rather than ice cubes) and to set a color mood per song.
- Shareable links to a specific song's visuals.
- A second music source, such as SoundCloud, for independent artists.

---

## 9. Beginner glossary

- **Terminal** — a text window for typing commands. Cursor has one built in (View → Terminal).
- **`npm run dev`** — starts the site on your computer at localhost:3000. Stop it with Ctrl+C.
- **Commit** — a saved snapshot of your code with a short note. In Cursor's Source Control panel: type a message ("Phase 2: search works"), click Commit.
- **Push / Sync** — sends your commits to GitHub. Vercel then updates the live site automatically.
- **Environment variable** — a secret setting (like an API key) kept outside the code.
- **API route** — a small piece of server code in `app/api/` that the website calls; it's where keys stay hidden.
- **Cache** — a saved copy of a result, so we don't ask an outside service the same question twice.
- **Deploy** — publishing the current code to the live website.
