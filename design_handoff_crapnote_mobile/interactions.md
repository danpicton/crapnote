# Interactions

## Swipe gestures (note list rows)

The single biggest UX change. Replaces the desktop's tiny inline pin/star/archive/trash buttons.

### Motion
- Pointer/touch down → start drag
- On move, translate the row body horizontally by `dx` (clamped to `[-180, 180]`)
- Action panels under the row are revealed by the translation; their opacity goes 0→1 once `|dx| > 4`
- On release:
  - `|dx| < 60` → snap back to 0 (transition 250 ms cubic-bezier(.2,.8,.2,1))
  - `dx ≥ 60` → snap to +140 (right-side actions exposed)
  - `dx ≤ -60` → snap to -140
- A subsequent tap on the exposed action triggers it. Tapping the row body when actions are exposed snaps back to 0 (does not open the note).

### Action mapping
- **Right-swipe** (drag right): reveals **Pin** then **Star** on the left
- **Left-swipe** (drag left): reveals **Archive** then **Delete** on the right
  - In the Archive screen: reveals **Restore** then **Delete forever** instead.

### Accessibility
- Provide a long-press → context menu fallback exposing the same actions (Pin / Star / Archive / Delete) so users without swipe (or with reduced motor control) can reach them.
- Each action button must have an accessible label.

## Pull-to-sync

On the note list scroll container:
- Drag down past 0 → translate the list body downward by `dy` (resisted; max ~80 px)
- A small indicator row reveals at the top: sync icon + "Release to sync…" (or "Syncing…" once released past threshold)
- Release at `dy ≥ 56` → trigger sync; show "Syncing…" with rotating sync icon for the duration
- After completion: snap back, sync status row updates to "SYNCED · just now"
- Failure: sync row shows "OFFLINE · last 14:02" red state, brief shake on the row.

## Sync status row

- Lives above the bottom tab bar **only** on the note list.
- Tap → forces a sync (same as pull-to-sync, but no gesture animation).
- Long-press → opens a small popover with the full timestamp and "Force sync" button.

## Bottom tab bar

- Standard tab switching. No transitions between top-level screens beyond a 150 ms cross-fade.
- Tapping the active tab on the note list scrolls it to top.
- "Sign out" tab triggers a confirm sheet ("Sign out of dadmin?") rather than a tab change.

## ⋯ action sheet (note edit)

- Open: `⋯` button taps. Sheet slides up from bottom in 220 ms ease-out, backdrop fades in.
- Dismiss: tap backdrop, drag handle down past 80 px, or tap any action.
- Each action triggers its operation and dismisses the sheet. Delete shows a confirm step ("Delete note?") before destroying.

## Tag sheet

- Open from `+ tag` chip in note edit, or from the "Edit tags" row in the action sheet.
- Adding a tag: tap a suggested chip → it moves into the current-tags row, animated 180 ms.
- Removing: tap the `×` on a current tag chip → it fades + slides out.
- Creating: type into the input, hit `+` → adds chip and clears input.
- Sheet stays open through multiple operations; user dismisses explicitly with the drag handle or backdrop.

## Format toolbar

- Visible only when the editor is focused. Hidden in reading state.
- Sits directly above the iOS / Android keyboard.
- Buttons must NOT steal focus — use `onPointerDown: e.preventDefault()` so the editor stays active and inserts the formatting at the cursor.
- Active state: when current selection has e.g. bold applied, the **B** button shows `accentSoft` background + `accent` icon. This is the desktop bug the redesign fixes.
- The row scrolls horizontally; momentum scroll is fine; hide the scrollbar.

## Tabs (note list: ALL / STARRED / TAGS)

- Plain segmented switching. ALL and STARRED show the note list; TAGS swaps the body for the filter list.
- Tapping a tag in the TAGS body filters the note list and switches back to the ALL tab with a filter chip shown above the list (chip: 12 px sans, `accentSoft` bg, `accent` text, dismissible × — clears the filter and returns to plain ALL).

## Wordmark / app-bar rules

- **Note list** (top-level): full wordmark "Crapnote." in 26 px serif, top-left.
- **Subpages** (Settings, Archive, User management, Note edit): no wordmark. Just back chevron + page title row.
- **Page title row** in subpages: 30 px serif 700 with the accent `.` (Settings., Archive., Users.). Sits below the back-chevron row.
- This fixes the desktop bug "Archive and settings screens have title overlapping crapnote type mark." (Stakeholder noted this should also be fixed on desktop — out of scope here, but flag it in the PR description.)

## Mobile-specific deletions

- All `Ctrl+…` hints (`Ctrl+K`, `Ctrl+.`, etc.).
- The "Keyboard shortcuts" section in Settings, including the `?` trigger reference.
- The desktop's tiny per-row star/pin/archive/trash buttons (replaced by swipe).
- The floating tag popover (replaced by full-width sheet).

## Breakpoint

Mobile rules apply at viewport width ≤ 640 px (or whatever existing breakpoint the app uses). Above that, desktop unchanged.

## Dark mode

Same structural rules; only colour tokens change. Refer to `tokens.md` dark column. Star/pin icons stay grey (`muted` resolves to `#7C7468` in dark) — the monochrome convention holds in both themes.
