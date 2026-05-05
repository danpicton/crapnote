# Per-screen specification

All screens render in a 402 × 874 viewport (iPhone 15 Pro CSS px). Top **54 px** is reserved for the iOS status bar / Dynamic Island — the first row of every screen begins at `padding-top: 54px`. The bottom safe area / home indicator (~34 px) is below the bottom tab bar.

Two themes (light / dark) — see `tokens.md`.

---

## 1. Note list

The home screen.

### Top header (sticky, doesn't scroll)
- Padding: `54px 20px 6px`
- Row 1 (height 36 px, `space-between`):
  - Left: Wordmark **"Crapnote."** in serif, 26 px, weight 700, with the `.` in `accent` colour.
  - Right: circular `+` button — 40 × 40, 1 px `hair` border, `border-radius: 22`, plus icon 20 px stroked in `text2`.
- Row 2 — search bar:
  - 11 px / 14 px padding, `surface2` background, 1 px `hair` border, radius 12.
  - Magnifier icon 16 px (`muted`), placeholder text `Search {N} notes` in `muted`, 16 px sans.
  - **Remove the desktop's `Ctrl+K` hint** — never on mobile.

### Tabs row (sticky)
- Three segments: **ALL · STARRED · TAGS**
- Tab style: 13 px sans, weight 700, `letter-spacing: 1.2px`, UPPERCASE
- Inactive: `muted`. Active: `text` with a 2 px high `accent` underline at the bottom of the cell.
- Padding: `12px 0 14px` per cell, `gap: 24px` between cells, side padding 20 px. Bottom border 1 px `hair`.

### List body — ALL / STARRED tabs
- A column of `NoteRow` components (see Components section), no per-row padding wrapper — each row sits flush.
- Empty state for STARRED: same as Archive empty (icon + "No starred notes yet").

### List body — TAGS tab
- Section label `FILTER BY TAG`, 11 px sans 700, `muted`, `letter-spacing: 1.4px`. Padding `0 22px 8px`.
- Each tag is a 14-px-padded row: `[8 px coloured dot] [tag name, 16 px text] ........ [count, 13 px muted]`. 1 px `hair` divider beneath each row. Side padding 22 px.
- Tag dot colour: assign deterministically per tag (hash → palette of 6 muted colours: `#5E8E6E #C99A2E #7A8AC4 #B26A4F #8B6FAE #5E8E6E`). If the existing app has tag colours, use those instead.
- Last row: `+ New tag…` in `muted`, opens an inline rename input.

### Sync status row (above bottom tab bar, ONLY on note list)
- 28 px high, padding `6px 18px`, top border 1 px `hair`.
- Layout: `[8 px dot] [icon 13 px] [LABEL] ............ [last-synced timestamp]`
- States:
  - `synced` — green dot, check icon, "SYNCED · just now" — colour `#5E8E6E`
  - `pending` — grey dot, sync icon, "NOT SYNCED · last 14:02"
  - `syncing` — grey dot, sync icon, "SYNCING…"
  - `offline` — red dot, x icon, "OFFLINE · last 14:02" — colour `#C0432A`

### Bottom tab bar
- 4 tabs: Notes / Archive / Settings / Sign out
- 6 px top padding, 10 px bottom (above home indicator), top border 1 px `hair`
- Each tab: icon 22 px above 11 px sans label, both `muted`; active tab uses `accent` colour
- Tap: switches tab. "Sign out" is destructive — should confirm via a small alert sheet (use the existing confirm pattern).

---

## 2. Note edit

Two top-level states: **reading** (no toolbar) and **editing** (toolbar above keyboard).

### Top bar
- Padding `54px 8px 10px`, bottom border 1 px `hair`.
- Layout: `[‹ back 44×44] [spacer flex:1] [⭐ 44×44] [⋯ 44×44]`
- **No wordmark** on subpages.
- Star icon: solid star, **grey monochrome** (`muted`). When toggled on, fill stays `muted` — desktop does not use accent colour for star state, and we match.

### Content
- Title: 28 px serif 700, `letter-spacing: -0.4`, padded `20px 22px 8px`.
- Tag chips row (under title):
  - `gap: 8px`, wrap. Tag chips: 12 px sans 600, padding `4px 10px`, radius 999, background `accentSoft`, colour `accent`.
  - **No `#` prefix** — just the tag name.
  - Trailing `+ tag` chip: dashed `faint` border, no fill, `muted` text. Tapping opens the **Tag sheet**.
- Body: 17 px serif, line-height 1.55, colour `text`, padding `4px 22px 24px`. Markdown rendering as in desktop. **No scrollbar visible** — `::-webkit-scrollbar { display: none; }` and `scrollbar-width: none;` on the editor scroll container.
- Footer (below body, above toolbar): 11 px sans `muted`, `letter-spacing: 0.3`, padding `8px 22px`, top border 1 px `hair`. Layout: `[date · time] ............ [N words · saved]`.

### Format toolbar — visible only when editor is focused
- Single horizontal row, `overflow-x: auto`, scrollbar hidden.
- 13 icon buttons in order: H, B, I, U, link, quote, code, list, ordered list, checklist, hr, undo, redo
- Each button: 42 × 42, 9 px radius, transparent background; icon 20 px in `text2`.
- **Active formatting state:** background `accentSoft`, icon and stroke recoloured to `accent`. This solves the desktop bug "buttons don't remain clicked when their formatting is active."
- Toolbar **must not steal focus from the editor** — use `onMouseDown: e.preventDefault()` (or equivalent in your framework) on every button.
- Sits directly above the keyboard. When the keyboard is dismissed (state = reading), the toolbar disappears too.

### `⋯` action menu (sheet)
- Bottom sheet, max-height 70%, top radius 18 px, drag handle (40 × 4 `faint` pill) centered at top.
- Title `Note actions` 18 px serif 700.
- Rows (each 14 px `padding-y`, 20 px `padding-x`, 14 px gap, bottom border 1 px `hair`):
  1. Pin to top (`pin` icon, `text2`)
  2. Unstar (`star-filled` icon, `accent`) — toggles based on current state
  3. Edit tags (`tag` icon, `text2`) → opens Tag sheet
  4. Archive (`archive` icon, `text2`) → archives, returns to list
  5. Force sync (`sync` icon, `text2`)
  6. Delete (`trash` icon, **`danger` red** `#C0432A`)
- Backdrop: `rgba(0,0,0,0.32)` overlay; tap to dismiss.

### Tag sheet
- Same sheet shape as action menu. Title `Tags`.
- Body padding `6px 18px 12px`:
  - Current tags: pill chips (14 px sans 600, padding `8px 14px`, radius 999, `accentSoft` bg, `accent` text), each with a small `×` (12 px) on the right to remove.
  - Section label `SUGGESTED` (11 px 600, `muted`, `letter-spacing: 1px`)
  - Suggested tags: 14 px sans, `surface2` bg, `text2` text, 1 px `hair` border, radius 999, padding `8px 14px`. Tap to add.
  - New-tag input: a row with `surface2` background, radius 12, 1 px `hair` border, padding `12px 14px`. Layout: `[# muted] [input flex:1, 16 px sans] [+ button 32×32, accent bg, white plus]`.

---

## 3. Settings

### App-bar (no wordmark)
- 54 px top padding. Layout: `[‹ back 44×44] [spacer] [trailing slot empty]`.
- Title row: `Settings.` (with accent dot) — 30 px serif 700, padded `8px 8px 2px`. The dot styling matches the wordmark.

### Sections (each separated by 1 px `hair` bottom border, padding `20px 22px 18px`)

1. **Export** — heading + subtitle "Everything you've written, as Markdown."
   - Field: `Password (optional)` (single-line, 12 / 14 padding, 10 radius, `surface` bg, 1 px `hair`)
   - Primary button (full-width): "Export notes" — `accent` bg, white 16 px sans 600, 13 / 16 padding, 10 radius
   - Hint: 13 px sans `muted`, line-height 1.4. Includes `.md` rendered as a `mono` chip — `surface2` bg, 4 radius, 1 / 6 padding.

2. **Administration** — subtitle "Users and who can do what."
   - Single row button "User management" with chevron right — full-width, 14 / 16 padding, 12 radius, `surface` bg, 1 px `hair`. → opens User management screen.

3. **Change password** — subtitle "For this account. Signs you out of other sessions."
   - Three labelled fields: CURRENT PASSWORD / NEW PASSWORD / CONFIRM NEW PASSWORD
   - Each label: 11 px sans 700, `muted`, `letter-spacing: 1.2`, UPPERCASE
   - Each field: as above + eye icon (18 px `muted`) on the right.
   - Primary button: "Update password"

4. **Sync** — subtitle "Last synced 2 minutes ago over Wi-Fi."
   - Row button "Force sync now" with sync icon trailing.

5. **Appearance**
   - Two toggles: "Dark mode" / "Use system theme"
   - Toggle: 46 × 28 track, 14 radius. On = `accent`, off = `faint`. Knob 24 × 24 white circle with subtle shadow, slides 18 px.

### Footer
- "Crapnote 2.4.1 · dadmin" — centered, 12 px sans `muted`, padding `24px 22px 8px`.

### **DELETED from desktop on mobile**
- The entire **"Keyboard shortcuts"** section (heading + table). Do not render it at all on mobile.
- All `Ctrl+…` hints and `?` cheat-sheet trigger references.

### No sync status row on Settings (per stakeholder feedback — only on note list).

---

## 4. Archive

- Same app-bar pattern as Settings, title "Archive."
- **Empty state:** centered column, `gap: 12`, padding 32, text-align center.
  - 64 × 64 circle, `surface2` bg, archive icon 28 px in `muted`.
  - "Nothing archived" — 20 px serif `text`.
  - "Swipe a note left and tap Archive to tuck it away here." — 14 px sans `muted`, max-width 240, line-height 1.4.
- **Populated state:** same `NoteRow` component as note list. Swipe gestures still apply (left-swipe shows "Restore" + "Delete forever" instead of Archive + Delete).
- Bottom tab bar (Archive tab active). No sync row.

---

## 5. User management

- App-bar title "Users." (accent dot)
- **Create user** section:
  - Subtitle "Add someone to this Crapnote instance."
  - Two segmented radio pills (50/50 width, `gap: 6`): "Set password now" (active) | "Send setup link"
    - Active pill: 1 px `accent` border, `accentSoft` bg, `accent` text, with a 14 × 14 radio circle showing a 6 × 6 `accent` dot.
    - Inactive: 1 px `hair` border, `surface` bg, `text2` text, empty `faint` radio circle.
  - Three fields: Username / Password (with eye) / Confirm password (with eye)
  - "Make admin" checkbox (22 × 22, 5 px radius, 1.5 px `faint` border) + label.
  - Primary button "+ Create user".
- **Users** section:
  - Subtitle "Everyone with access."
  - Card list (replaces the desktop's cut-off table). Each row 14 px padding-y, bottom border 1 px `hair`:
    - Avatar circle 36 × 36 with first letter in serif 700 15 px, `surface2` bg.
    - Name 15 px sans 600 + status badge (10 px sans 700, `letter-spacing: 0.6`, padding `2px 6px`, radius 4): ACTIVE (`surface2` bg, `text2`) or INVITED (`accentSoft` bg, `accent`).
    - Sub-line: 12 px sans `muted` — "Role · token info · created date"
    - Trailing chevron 16 px `muted`.
- Bottom tab bar (Settings tab active — User management is reached via Settings).

---

## NoteRow component (shared)

Used in note list, archive (populated). Two-line clamp on preview.

- Padding `16px 20px`, bottom border 1 px `hair`, `background: bg`.
- Layout: `[main column flex:1] [right column gap:6, padding-top:2]`
- Main column:
  - Title: 18 px serif 700, `text`, `letter-spacing: -0.1`, line-height 1.25, single-line ellipsis. Margin-bottom 4.
  - Preview: 14 px sans `text2`, line-height 1.4, two-line `-webkit-line-clamp: 2`. Margin-bottom 6.
  - Date: 12 px sans `muted`, `letter-spacing: 0.1`.
- Right column:
  - Star indicator (read-only): 16 px star, **`muted`** stroke, when `note.starred`.
  - Pin indicator (read-only): 16 px pin, **`muted`** stroke, when `note.pinned`.
  - **Both grey monochrome** to match desktop. Do not use accent.

### Swipe gestures (see `interactions.md` for full spec)
- The row's main body translates on touch-drag.
- Right-swipe (drag right): reveals **Pin** + **Star** action panels on the left side (each 72 px wide, full row height).
- Left-swipe (drag left): reveals **Archive** + **Delete** action panels on the right side.
- Action panel: column-flex, centered, `surface` text colour `#FBF7F0`, 11 px sans 600 `letter-spacing: 0.3`, 20 px icon stacked above label with 4 px gap.
  - Pin bg `#C99A2E` / Star bg `#B9923A` / Archive bg `#5E8E6E` / Delete bg `#C0432A`
- In Archive (populated), left-swipe actions become **Restore** (`#5E8E6E` + restore icon) + **Delete forever** (`#C0432A` + trash icon). Right-swipe is disabled.
