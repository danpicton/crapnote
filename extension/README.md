# CrapNote Web Clipper

Browser extension for Chrome/Brave and Firefox that saves links and web clips
into [CrapNote](../README.md), with optional full-page saves to Readeck.

Both builds share the same TypeScript source; only the manifest differs
(Chrome uses an MV3 service worker, Firefox an MV3 event page).

## Features

- **Save link** — click the toolbar icon: title (prefilled from the page),
  URL, description, and tags. The tags box starts with your default link tag
  (`Links`) and autocompletes from your existing CrapNote tags; new tags are
  created automatically.
- **Clip selection** — select text/images, right-click → *Clip selection
  with images to CrapNote* or *Clip selection without images to CrapNote*.
  In the popup, images show as a `<image content>` placeholder; on save
  each placeholder becomes the real image, uploaded to CrapNote's image
  store. Default tag `Webclip`.
- **Clip image** — right-click a single image → *Clip image to CrapNote*.
- **Readeck** — when a Readeck URL + token are configured in options, the
  link popup offers "Also save to Readeck" (full pages only, so not in the
  clip view). Other services can be added by implementing a `Destination`
  in `src/core/destinations.ts`.

## Setup

1. In CrapNote, create an API token with **read/write** scope
   (Settings → API tokens).
2. In the extension options, set your server URL and paste the token.
   Optionally set the Readeck URL/token and change the default tags.

## Build

```bash
npm install
npm test            # vitest
npm run check       # tsc
npm run build       # dist/chrome + dist/firefox (+ zips when `zip` exists)
```

Load it unpacked:

- **Chrome/Brave**: `chrome://extensions` (or `brave://extensions`) →
  enable Developer mode → *Load unpacked* → `extension/dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on* → any file inside `extension/dist/firefox`
  (or install the zip via `about:addons` once signed).

## Layout

```
src/core/       tested browser-agnostic logic (API client, tags, clip
                masking, note building, settings, destinations)
src/popup/      save popup — link and clip modes share one page
src/options/    options page
src/background.ts  context menus + selection capture
build.mjs       esbuild bundling + per-browser manifest + icons + zip
```
