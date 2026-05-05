# Design tokens

These match the existing desktop palette — only the application changes for mobile. Use whatever variable system already exists in the codebase; don't introduce a new one if one is in use.

## Colour — light

| Token       | Hex                          | Use                                          |
|-------------|------------------------------|----------------------------------------------|
| `bg`        | `#F5F1EA`                    | App background                               |
| `surface`   | `#FBF7F0`                    | Cards, sheets, raised surfaces               |
| `surface2`  | `#EFE9DC`                    | Inputs, chips, secondary surfaces            |
| `text`      | `#1F1B16`                    | Primary text, headings                       |
| `text2`     | `#4A423A`                    | Secondary text, body, icon stroke            |
| `muted`     | `#9C9489`                    | Tertiary text, placeholders, dim icons       |
| `faint`     | `#C9C0B2`                    | Disabled, dashed borders, toggle off track   |
| `hair`      | `rgba(31,27,22,0.08)`        | Dividers, hairlines, button outlines         |
| `accent`    | `#E15A3C`                    | Brand orange — wordmark dot, primary buttons, active tab indicator |
| `accentSoft`| `rgba(225,90,60,0.12)`       | Tag chips, accent-on-bg highlights           |

## Colour — dark

| Token       | Hex                          |
|-------------|------------------------------|
| `bg`        | `#1A1816`                    |
| `surface`   | `#211E1B`                    |
| `surface2`  | `#272320`                    |
| `text`      | `#F0EAE0`                    |
| `text2`     | `#C7BEB1`                    |
| `muted`     | `#7C7468`                    |
| `faint`     | `#48433D`                    |
| `hair`      | `rgba(255,255,255,0.07)`     |
| `accent`    | `#E15A3C` (unchanged)        |
| `accentSoft`| `rgba(225,90,60,0.18)`       |

## Semantic colours (gestures + sync)

| Token            | Hex        | Use                                       |
|------------------|------------|-------------------------------------------|
| `gesturePin`     | `#C99A2E`  | Right-swipe Pin action background         |
| `gestureStar`    | `#B9923A`  | Right-swipe Star action background        |
| `gestureArchive` | `#5E8E6E`  | Left-swipe Archive action; sync = synced  |
| `gestureDelete`  | `#C0432A`  | Left-swipe Delete action; sync = offline  |
| `syncSynced`     | `#5E8E6E`  | Sync status pill, synced                  |
| `syncPending`    | `muted`    | Sync status pill, not synced              |
| `syncOffline`    | `#C0432A`  | Sync status pill, offline                 |

## Typography

- **Serif** (wordmark, headings, note titles, note body): Newsreader (Google Fonts). The desktop app currently uses a Caslon-ish serif — match that. Weights 400, 600, 700; italic 400.
- **Sans** (UI text, labels, buttons, tags): system stack — `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`.
- **Mono** (markdown shortcuts, code spans like `.md`): `"SF Mono", ui-monospace, Menlo, monospace`.

### Sizes

| Use                                | Size  | Weight | Line height |
|------------------------------------|-------|--------|-------------|
| Wordmark (note list header)        | 26 px | 700    | 1.0         |
| Page title (Settings./Archive.)    | 30 px | 700    | 1.1         |
| Note title (editor)                | 28 px | 700    | 1.15        |
| Note title (list row)              | 18 px | 700    | 1.25        |
| Section heading (Settings)         | 19 px | 700    | 1.3         |
| Body / note text                   | 17 px | 400    | 1.55        |
| Form labels                        | 11 px | 700    | 1.0 — `letter-spacing: 1.2px` UPPERCASE |
| Tab label (ALL/STARRED/TAGS)       | 13 px | 700    | 1.0 — `letter-spacing: 1.2px` UPPERCASE |
| Bottom-tab label                   | 11 px | 400    | 1.0 — `letter-spacing: 0.2px`           |
| Sync status row                    | 11 px | 600    | 1.0 — `letter-spacing: 0.4px` UPPERCASE |
| Note row preview                   | 14 px | 400    | 1.4         |
| Note row date                      | 12 px | 400    | 1.0         |

## Spacing

- 8 / 12 / 14 / 18 / 20 / 22 / 32 px scale, used opportunistically
- Page side padding: **20 px** (note list rows), **22 px** (settings sections)
- Sheet bottom padding: 16 px
- Top safe-area padding (below iOS status bar): **54 px** on the first row of every screen

## Radii

- 6 px — small chips (markdown shortcut hints)
- 9–10 px — buttons, fields
- 12 px — search bar, sheet rows
- 18 px — sheets (top-only)
- 22 px — circular `+` button on note list (40 × 40 with `border-radius: 22`)
- 999 px — tag chips, status pill segmented control

## Hit targets

- All interactive icons sit inside a 44 × 44 px tap area minimum
- Toolbar icon buttons: 42 × 42 within a single horizontally-scrollable row
- Bottom tab buttons: 56 px tall (icon + label)
