# Handoff — Crapnote mobile redesign

## Overview

A first-pass mobile redesign of Crapnote, a markdown note-taking app. Scope is **mobile only** — the desktop view is intentionally untouched. The goal is to fix the mobile experience, which currently is a near-direct port of the desktop layout (tiny tap targets, cramped chrome, awkward toolbar, ugly tag popover, title overlapping the wordmark).

The redesign covers five screens:
1. Note list
2. Note edit (reading + editing states)
3. Settings
4. Archive
5. User management

Plus secondary surfaces: a `⋯` action menu sheet, a tag picker sheet, and a Tags filter tab.

## About the design files

The HTML/JSX files in this bundle are **design references**, not production code. They render inside an iOS device frame on a side-by-side canvas so all states and screens can be compared at once. Class names, file structure, and component shapes are demo-only.

Your job in the target codebase (the existing Crapnote frontend on the `mobile-redesign` branch you'll be working in) is to **recreate the look and behaviour described here using the project's existing components, styles, and patterns**. Don't lift HTML/JSX directly — port the design decisions onto the real components.

## Fidelity

**High-fidelity.** Colours, typography, spacing, gestures, and state transitions are all final. Recreate pixel-perfectly, adapted to the codebase's CSS conventions (CSS modules, Tailwind, plain CSS — whatever's in use).

## Files in this handoff

- `README.md` — this file
- `tokens.md` — extracted design tokens (colours, type, spacing)
- `screens.md` — per-screen detailed spec
- `interactions.md` — gestures, sheets, state transitions
- `screenshots/` — 20 PNG references (note list states, note edit, settings, archive, user mgmt — light + dark). See `screenshots/README.md` for index.
- `reference/` — the original HTML/JSX prototype files. **Design references only — do not lift verbatim.** Class names, structure, and React patterns here are demo scaffolding; recreate the design in your codebase's existing component library and conventions.

## Scope reminder

**Mobile only.** Do not touch desktop styles. The mobile breakpoint should activate on viewports ≤ ~640px wide (or whatever the codebase already uses). Keyboard shortcuts and any `Ctrl+K` / `Ctrl+.` hints must be **hidden on mobile** — including the entire "Keyboard shortcuts" section in Settings.

## Branch

Suggested: `mobile-redesign` off `main`. Single PR. Each commit can be one screen or one cross-cutting concern (tokens, app-bar, bottom tab bar, swipe gesture util, etc.) for easier review.
