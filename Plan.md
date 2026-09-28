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
| Videos (Phase 9B) | **Pexels Video API** | Same key and rate limit as photos; returns videographer credits. Comes before any AI scene work. | Same Pexels key |
| Caching | **Next.js built-in fetch caching** | Saves API results so repeated songs don't use up rate limits. No database needed for v1. | — |

### Known limitations (decided, not bugs)

- **Full songs need Spotify Premium.** The Spotify player only plays full tracks for listeners logged in to Spotify Premium in that browser. Everyone else hears a 30-second preview. The login prompt (Section 5.6) helps logged-out Premium users; free-account users will still hear previews even after logging in. Fine for you and a few friends; revisit before a wider launch.
- **We can't directly ask Spotify whether someone is logged in.** The player runs on Spotify's site, not ours, so login status isn't shared with our code. We detect preview mode indirectly instead (Section 5.6).
- **Your Spotify developer app requires you to have Spotify Premium.** If your Premium lapses, the Deezer → Spotify matching stops working.
- **"Immediately plays" may need one click.** Browsers restrict audio that starts without a click. Selecting a result counts as a click on *our* page, but the Spotify player is embedded from Spotify's site, so some browsers may still require the user to press play once. Test in Phase 1.
- **Deezer's API is for non-commercial use.** No ads or paid tier while using it.
- **Pexels is limited to 200 requests/hour.** Photo and video searches share that limit. Caching and a per-song cap on keywords (Section 5) keep us well under.
- **Lyrics are used, not displayed.** They drive image selection only, which keeps us clear of lyric copyright issues. Turning lines into AI scene phrases is saved for later and is not part of this first pass.
- **Video files are large.** Phase 9B prefers clips around 1280–1920 pixels wide and preloads only the next one, so a slow connection can still keep up.

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
  albumCoverUrl: string;    // Deezer album.cover_xl, for the opening title card
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
7. For each scene, search Pexels and keep enough good landscape photos for every time the picture will change in that scene. Do not reuse a photo later in the same song, and do not replay a photo inside a long scene (see Section 5.2a).

### 5.2a Photo quality rules (added before Phase 7)

The goal is photos that feel artistic and cinematic, not like stock photography.

- **Request 20 results per keyword.** Skip any that fail the blocklist, then pick at random from what's left — enough photos for every change in that scene, not always the first results. If one page isn't enough, ask for page 2.
- **One short style word per scene**, rotating through `lib/style-words.ts`: `moody, dusk, night, silhouette, shadow, texture, fog, light, abstract`. The search is `"{keyword} {style word}"`. The word `film` and the longer phrase `cinematic film photography` were both tried and removed: Pexels treated them literally and returned photos of film rolls, cameras, and crews.
- **Never reuse a photo in the same song.** Track photo ids already chosen and skip them for later scenes. The screen also does not loop back to an earlier photo inside a long scene. If it runs out of new photos, the last one stays up.
- **Skip photos of text and obvious stock shots.** If a photo's `alt` text contains any word or phrase from `lib/photo-blocklist.ts`, skip it. Ignore upper/lower case. A single word must match a whole word ("sign" does not match "design"). A phrase must appear as written ("neon sign"). Starting list: `text, word, letters, typography, sign, quote, written, scrabble, tiles, alphabet, neon sign, smiling, business, office, laptop, posing`. Edit the list freely as you spot new offenders.
- **If there aren't enough new photos,** search again with the keyword alone (no style word). If that is also short, use whatever survived (at least 1). If none survived, use curated photos that this song has not already used.

### 5.3 The visual engine (runs in the browser)

- The Spotify player reports its position about once a second. Between updates, estimate the position smoothly using the time elapsed since the last update (only while playing).
- On every animation frame:
  1. Find the scene whose `startMs ≤ position < endMs`.
  2. Pick the photo within that scene: `photoIndex = min(floor((position − scene.startMs) / imageIntervalMs), photos.length − 1)`. Do not wrap with `%`. A photo is not shown again.
  3. If it's different from what's on screen, crossfade to it.
- **Scene changes happen exactly at lyric timestamps.** Within a scene, photos change on the beat grid.
- **Opening title card.** If the first lyric scene starts after 0:00, show the album cover full-screen (blurred, slow zoom) with the song title and artist from 0:00 until that lyric, then crossfade into the first photo. Also keep the title card up while the first photos are still loading. Styling stays simple until Phase 10.
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
  - "Footage by" — every videographer whose clip was displayed (Phase 9B only), each linking to their Pexels profile
  - Footer, before video: "Photos provided by Pexels · Lyrics from LRCLIB · Search by Deezer · Music on Spotify"
  - Footer, once video ships: "Photos and videos provided by Pexels · Lyrics from LRCLIB · Search by Deezer · Music on Spotify"
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

### 5.7 Video (Phase 9B — an experiment, not part of the first launch)

Same timing rules as photos: the picture on screen is always calculated from the playback position. A clip does not start at a random moment, or rewind would show something different each time.

- Search with the same keyword the photos use. This first pass does not wait on AI scene phrases.
- Prefer one landscape file per scene, about 1280–1920 pixels wide, `quality: "hd"`. If none is that size, use a smaller landscape file. If there is still no landscape clip, show the scene's photos instead.
- Play muted. Where we are in the clip = how far we are into the scene, looping if the clip is shorter than the scene.
- Cut from one clip to the next at the same moments photos would change (lyric line, or the beat grid inside a long scene).
- Preload the next clip only.
- Three modes, remembered for the visit:
  - **Photos** — what the app does today.
  - **Video** — clips, with photos filling any scene that has no clip.
  - **Mix** — video only on scenes whose word appears more than once (the chorus). Everything else stays photos.

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
- Search: `GET https://api.pexels.com/v1/search?query={keyword} {styleWord}&per_page=20&orientation=landscape` (then filter with the blocklist and pick 3 at random — Section 5.2a). If fewer than 3 survive, repeat with `query={keyword}`.
- Random/curated: `GET https://api.pexels.com/v1/curated?per_page=20`
- Photo fields used: `id`, `src.large2x`, `alt`, `avg_color`, `photographer`, `photographer_url`, `url`
- Video search (Phase 9B): `GET https://api.pexels.com/videos/search?query={query}&per_page=15&orientation=landscape` (note: no `/v1/` in this path)
  - Video fields used: `id`, `duration`, `image` (poster/thumbnail), `url`, `user.name`, `user.url`, and `video_files[]` → pick a landscape file (`width` ≥ `height`) around 1280–1920 wide with `quality: "hd"`, and use its `link`. If none fit, use the smallest landscape file.
  - Videos share the same 200 requests/hour limit as photos, so cache them the same way (24 hours)
- Required credit: a visible "Photos and videos provided by Pexels" link, and credit photographers/videographers where possible

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
  photo-blocklist.ts       ← words that disqualify a photo (Section 5.2a)
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

### Phase 6B — Photo quality pass (do before Phase 7)

**Goal:** fewer stock-looking photos and no photos of words (e.g. "wonder" spelled in Scrabble tiles).

> **Prompt:** "Phase 6B of @PLAN.md, following Section 5.2a. Update pexels.ts: (1) request 20 results per keyword, (2) skip any photo whose alt text contains a word from a new file lib/photo-blocklist.ts (start it with: text, word, letters, typography, sign, quote, written, scrabble, tiles, alphabet, neon sign, smiling, business, office, laptop, posing). Search the keyword alone — do not add a style phrase. On the /debug page, show a before-and-after comparison for the keyword \"wonder\": the old results next to the new ones."

✅ **Check:**
- On /debug, the "after" results for "wonder" contain no photos of written words.
- A few other songs still get 3 photos per scene (or a sensible fallback), and the visualizer still works.
- The blocklist lives in its own file so you can edit it without touching other code.

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

### Phase 9B — Video (do this before designing; skip AI scenes)

**Not now:** Phase 9A (AI scene descriptions) is saved for another time. Do not add Claude, an Anthropic key, or `scene-writer.ts` in this first pass. Video searches use the same keywords as the photos.

**Goal:** try moving footage instead of (or mixed with) photos, and compare.

> **Prompt:** "Phase 9B of @PLAN.md. Follow Section 5.7 and the video notes in Section 6. Add Pexels video search to pexels.ts. For each scene, fetch one landscape clip; if none qualifies, keep that scene's photos. Play clips muted, with the frame calculated from the playback position (not a random start). Cut when the photo engine would have changed pictures, and preload only the next clip. Pause and seek must land on the matching frame. Add a Photos / Video / Mix toggle as defined in Section 5.7, and list videographers in the credits under 'Footage by'."

✅ **Check:**
- Try the same song in all three modes. Videos play silently, cut on the beat, and pause/skip with the song.
- No black flashes between clips (preloading works). Scenes with no matching video show photos instead.
- The credits list both photographers and videographers, each linking to Pexels.
- Try it on a slower connection (or your phone) to see if loading keeps up.

### Phase 10 — Apply your designs

Design the screens in Claude Design: search (empty and with results), playing, no-lyrics message, Spotify login prompt (including the "Reload player" and end-of-preview states), the Photos / Video / Mix toggle, credits, loading and error states. Then apply one screen per prompt.

Also design the **visual treatment** for the photos and video — a consistent color grade, duotone or tint, film grain, and slow drift/zoom. A shared treatment makes material from many photographers feel like one artistic vision. Ask Cursor to apply it with CSS, one effect at a time.

> **Prompt:** "Phase 10 of @PLAN.md. Restyle the [screen name] to match this design [attach image/link]. Only change styling and layout, not behavior. Use Tailwind. Make it work down to tablet width."

✅ **Check:** each screen matches the design and nothing that worked before is broken.

### Phase 11 — Launch

1. Remove the /test and /debug pages (or hide them).
2. Test the full flow in Chrome, Safari and Firefox.
3. **Custom domain:** when you buy one, add it in Vercel → Project → Settings → Domains and follow the instructions it shows for your domain provider.
4. Update `LRCLIB_USER_AGENT` to include your new domain.

✅ **Check:** friends can open the URL, search, and watch a song end to end.

### Later ideas (not this first pass)

**Phase 9A — AI scene descriptions.** Saved on purpose. Do this only when you ask for it, after the first pass (including video) is done.

Search for a *scene* instead of a single word ("I wonder where you are tonight" → "empty road at night, streetlights"), and give each song one consistent visual style. Lyrics would be sent to Claude only to write those phrases, never displayed. The Anthropic key would stay on the server (`ANTHROPIC_API_KEY` in `.env.local`, never in frontend code or git). Add `lib/scene-writer.ts` at that time.

> **Prompt, when you're ready:** "Phase 9A of @PLAN.md. Add lib/scene-writer.ts. After the lyrics are split into scenes, send the song title, artist, tempo and the lyric lines (server-side only, using ANTHROPIC_API_KEY) to Claude in one request, and ask for: a short visual search phrase for each scene (a concrete, photographable scene — never the literal word), and one style phrase for the whole song (for example 'moody, blue tones'). Search Pexels for '{scene phrase} {style phrase}' instead of the keyword alone, still applying the blocklist from Section 5.2a. Use the same phrases for video search. If the AI request fails, fall back to the current keyword search. Cache results per song for 24 hours. Never put the Anthropic key in frontend code. Show lyric line → scene phrase on the /debug page."

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
