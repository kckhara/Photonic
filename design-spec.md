# Lyric Film UI Spec Sheet

Sep 29, 2026 · @Casey K

## Overview

These values cover the direction C screens. All are designed at 1440 × 900 px except credits, which is 1440 × 1500 and scrolls.

- Components follow Material Design 3, using the M3 baseline dark scheme as stand-in color.
- The brand color is not set yet. Anywhere this sheet says "accent", swap in the brand color once it is chosen.
- Screens with a song playing put UI directly on a full-bleed photo with no scrim; each component carries its own fill for legibility. Screens without a photo use a flat dark background.
- The Spotify embed cannot be restyled. Only its height and width are ours to set.
- The About button (upper right) and About modal appear on every screen.

| Screen | Background | What's on it |
| --- | --- | --- |
| Homepage | Surface #141218 | Search bar, intro header and text centered on the page |
| Search results | Surface #141218 | Search bar with the results dropdown 4 px below it |
| Song playing | Photo | Search bar, media and color toggles, Spotify player |
| Loading | Black #000000 | Search, toggles, Spotify player, centered spinner and message |
| No lyrics found | Black #000000 | Search, toggles, Spotify player, centered message |
| Spotify login prompt | Photo | Search, Spotify player, prompt card at the bottom |
| Credits | Black #000000 | Search bar, song and musician, photo and video grids, Built with links |
| About modal | Any screen | Dimmed page with the About dialog centered |

The "song playing — collapsed" artboard predates these controls and still shows the old pill-style toggle; treat the song playing (media toggle) screen as the reference.

## Color

All values come from the M3 baseline dark scheme plus a few white overlays. Translucent fills are listed as rgba so they can be used as-is.

| Token | Value | Used for |
| --- | --- | --- |
| Background — photo fallback | #0E0D10 | Behind the photo while it loads |
| Background — surface | #141218 | Homepage, search results (no song selected yet) |
| Background — black | #000000 | No lyrics, loading and credits screens |
| Control fill | rgba(54, 52, 59, 0.72) | Search bar, both toggle bars, About button |
| Control fill — hover | rgba(74, 72, 80, 0.85) | About button hover |
| Selected segment | rgba(255, 255, 255, 0.50) | Selected option in either toggle |
| Dropdown and dialog surface | #2B2930 | Search results panel, About modal (solid) |
| Modal scrim | rgba(10, 9, 12, 0.72) | Page dimming behind the About modal |
| Prompt surface | rgba(20, 18, 24, 0.86) | Spotify login prompt |
| Credits tile | #1C1B1F | Photo and video thumbnails before they load |
| Placeholder shape | #49454F | Artist avatar, song art in search results |
| Text — primary | #E6E0E9 | Body text, input text, icons, homepage header |
| Text — heading | #FFFFFF | Headings on prompt and credits |
| Text — secondary | #CAC4D0 | Placeholder text, captions, meta, section labels, centered page messages, About body |
| Text — on selected | #1D1B20 | Label on a selected toggle option and on white buttons |
| Outline | #938F99 | Outlined "Maybe later" button |
| Divider | #49454F | Line between Artists and Songs; line above Contact me |
| Border — subtle | rgba(255, 255, 255, 0.08) | Dropdown and About modal edge |
| Border — prompt | rgba(255, 255, 255, 0.14) | Login prompt edge |
| Button — filled | #FFFFFF (hover #EAE6EE) | "Log in to Spotify" |
| Link | #D0BCFF (hover #EADDFF) | Credits "Built with" links |
| Hover — rows and segments | rgba(230, 224, 233, 0.08) | Search result rows, toggle options |
| Hover — icon and outlined buttons | rgba(230, 224, 233, 0.10–0.12) | Clear search, modal close, "Maybe later" |
| Focus ring | #FFFFFF, 2 px, 2 px offset | Every focusable control |

The Spotify placeholder colors (#1F1F1F body, #3A3A3A art) only stand in for the real embed and are not part of this palette.

## Typography

Roboto Flex (M3's typeface) sets all UI text. Instrument Serif is the display face, used only for the homepage header and the About title. Line height is normal unless listed.

| Role | Font | Size | Weight | Line height | Letter spacing | Color |
| --- | --- | --- | --- | --- | --- | --- |
| Credits — song title | Roboto Flex | 48 px | 600 | 1.15 | −0.01em | #FFFFFF |
| Homepage header | Instrument Serif | 48 px | 400 | 1.02 | −0.015em | #E6E0E9; "matched by their words" in #CAC4D0 |
| About title | Instrument Serif | 40 px | 400 | 1.05 | −0.01em | #E6E0E9 |
| No-lyrics message | Roboto Flex | 24 px | 300 | 1.35 | 0.005em | #CAC4D0 |
| Credits — section heading | Roboto Flex | 24 px | 600 | normal | 0 | #FFFFFF |
| Credits — musician | Roboto Flex | 22 px | 400 | normal | 0 | #CAC4D0 |
| Prompt title | Roboto Flex | 20 px | 600 | normal | 0.005em | #FFFFFF |
| Homepage intro text | Roboto Flex | 19 px | 300 | 1.65 | 0.005em | #CAC4D0 |
| Loading message | Roboto Flex | 18 px | 400 | 1.4 | 0 | #CAC4D0 |
| Search input and placeholder | Roboto Flex | 16 px | 400 | normal | 0.01em | #E6E0E9 / #CAC4D0 |
| Prompt body | Roboto Flex | 16 px | 400 | 1.5 | 0 | #E6E0E9 |
| About body | Roboto Flex | 16 px | 400 | 1.6 | 0 | #CAC4D0 |
| About "Contact me" link | Roboto Flex | 16 px | 500 | normal | 0 | #E6E0E9, underlined, 4 px offset |
| Search result name | Roboto Flex | 16 px | 400 | normal | 0 | #E6E0E9 |
| Credits links | Roboto Flex | 16 px | 400 | normal | 0 | #D0BCFF |
| Toggle labels (both toggles) | Roboto Flex | 15 px | 400 | normal | 0.01em | #E6E0E9 / #1D1B20 selected |
| Dropdown section label | Roboto Flex | 14 px | 600 | normal | 0.02em | #CAC4D0 |
| Button label — filled | Roboto Flex | 14 px | 600 | normal | 0.01em | #1D1B20 |
| Button label — outlined | Roboto Flex | 14 px | 500 | normal | 0.01em | #E6E0E9 |
| Credits caption | Roboto Flex | 14 px | 400 | normal | 0 | #CAC4D0 |
| Search result meta, song length | Roboto Flex | 13 px | 400 | normal | 0 | #CAC4D0 |

Load Roboto Flex from Google Fonts with weights 300, 400, 500, 600 and 700, and Instrument Serif (regular). The no-lyrics screen also loads Nunito, Open Sans and Inter, which nothing uses — drop them.

Homepage copy: header "Music and imagery, matched by their words"; body "The lyrics find a photo or video that share keywords, with no one choosing the pairing. Sometimes they harmonize, sometimes they don't. Either way, it's a show."

## Spacing and layout

Everything above the photo lives in one 568 px column, centered horizontally and starting 52 px from the top of the screen. Stacked controls sit 12 px apart: search bar, then the toggle row, then the Spotify player.

| Element | Value |
| --- | --- |
| Main column | 568 px wide, centered (x = 435 at 1440 px), top = 52 px |
| Gap between search, toggle row and player | 12 px |
| Gap between search bar and results dropdown | 4 px |
| Search bar | 56 px tall; padding 0 16 px right, 4 px left; 48 px icon slot; 4 px gap |
| Toggle row | Two bars on one line, 12 px apart, together 568 px: media toggle 328 px, color toggle 228 px |
| Toggle bar (each) | 40 px tall; 4 px inner padding; 4 px between options |
| Toggle option | 32 px tall; sized to its label (flex 1 1 auto, no wrapping); 0 10 px padding; 6 px checkmark-to-label |
| Spotify embed | 80 px tall, full column width (568 px) |
| About button | 56 × 56 px circle; 40 px from the right edge, top 52 px (level with the search bar); 24 px info icon |
| About modal | 560 px wide, centered on screen; padding 40 px top and sides, 36 px bottom; 20 px between title, body, divider and link; 14 px between body paragraphs; close button 48 px, 16 px from top and right; 10 px envelope icon to "Contact me" |
| Dropdown | 8 px top, 12 px bottom padding; section label padding 12 / 20 / 6 px; rows 56 px tall, 20 px side padding, 16 px between avatar and text; avatar and art 40 px; divider inset 20 px with 8 px above and below |
| Login prompt | 568 px wide, centered, 40 px from the bottom; 24 px padding; 12 px between title, body and buttons, plus 8 px more above the buttons; 12 px between buttons; buttons 40 px tall with 24 px side padding |
| Homepage intro | Centered on screen; header and text 16 px apart; header about 388 px wide (wraps to two lines); text max 600 px |
| Loading | 48 px spinner, 20 px above the message, centered on screen |
| No-lyrics message | Centered on screen, 240 px side margins (960 px max line) |
| Credits page | Search bar at top 52 px, centered; song title 72 px below it; 96 px bottom and 200 px side padding (1040 px content); 8 px title to musician; section headings 72 px above, 24 px below ("Built with" 20 px below) |
| Credits grids | 4 columns, 24 px column gap, 28 px row gap, 10 px image to caption; photo tiles 161 px tall (3:2), video tiles 136 px tall (16:9); link list 14 px apart |

## Corner radius

Controls are fully rounded: radius is always half the height. Cards, panels and dialogs use 28 px; tiles use 12 px.

| Element | Radius |
| --- | --- |
| Search bar (56 px) | 28 px |
| About button (56 px) | 28 px (circle) |
| Results dropdown | 28 px |
| About modal | 28 px |
| Login prompt | 28 px |
| Toggle bars (40 px) | 20 px |
| Toggle options (32 px) | 16 px |
| Prompt buttons (40 px) | 20 px |
| Icon buttons — clear search, modal close (48 px) | 24 px (circle) |
| Credits photo and video tiles | 12 px |
| Spotify embed | 12 px (set by Spotify) |
| Song art in search results | 6 px |
| Artist avatar | 20 px (circle) |

## Blur, shadow, borders and motion

Only the login prompt uses blur. The search bar, toggles and About button rely on their translucent fill alone, with no blur or shadow.

| Element | Backdrop blur | Shadow | Border |
| --- | --- | --- | --- |
| Search bar, toggle bars, About button | none | none | none |
| Results dropdown | none | 0 8px 24px rgba(0, 0, 0, 0.35) | 1 px rgba(255, 255, 255, 0.08) |
| About modal | none (page behind dimmed by the scrim) | 0 8px 24px rgba(0, 0, 0, 0.35) | 1 px rgba(255, 255, 255, 0.08) |
| Login prompt | blur(24px) | 0 8px 24px rgba(0, 0, 0, 0.35) | 1 px rgba(255, 255, 255, 0.14) |
| "Maybe later" button | none | none | 1 px #938F99 |

| Motion | Value |
| --- | --- |
| Expand search and controls | height 280 ms, cubic-bezier(0.2, 0, 0, 1); fade in 200 ms after an 80 ms delay; content slides 24 px down into place |
| Collapse | height 220 ms, same curve; fade out 120 ms |
| Loading spinner | one turn per 1.4 s, linear; 4 s per turn and a fixed arc when the system asks for reduced motion |

## Component states

Each component's default look is in the tables above; this lists what changes between states.

| Component | Default | Hover | Selected or active | Focus |
| --- | --- | --- | --- | --- |
| Search bar | Control fill, placeholder #CAC4D0 | — | Typed text #E6E0E9; clear (×) button appears; results open 4 px below | White ring |
| Media toggle | Options in order: Photo & Video, Photo, Video; Photo & Video selected | rgba(230, 224, 233, 0.08) | 50% white fill, label #1D1B20, 18 px checkmark before the label | White ring |
| Color toggle | Options in order: Black & White, Color; Black & White selected | rgba(230, 224, 233, 0.08) | Same as media toggle | White ring |
| About button | Control fill, 24 px info icon #E6E0E9; accessible name "About this project" | rgba(74, 72, 80, 0.85) | Opens the About modal | White ring |
| About modal | Hidden | — | Open: scrim over the page, dialog centered; closes with the × button | White ring on close and link |
| Search result row | Transparent | rgba(230, 224, 233, 0.08) | — | White ring |
| "Log in to Spotify" | #FFFFFF fill | #EAE6EE | — | White ring |
| "Maybe later" | Transparent, #938F99 outline | rgba(230, 224, 233, 0.10) | — | White ring |
| Credits link | #D0BCFF | #EADDFF | — | White ring |

The two toggles are independent: each keeps its own single selection. Only one option per toggle can be selected, and the options shift slightly in width as the checkmark moves.

The About modal is a true dialog: move focus into it when it opens, return focus to the About button when it closes, and close it on Escape. Keep it fixed in the viewport on the scrolling credits page. The "Contact me" link points to mailto:\[your email\] — fill in the address.

Icons are 24 px line icons with a 2 px stroke (1.8 px on music-note, envelope and image placeholders), drawn in currentColor so they take the text color around them.
