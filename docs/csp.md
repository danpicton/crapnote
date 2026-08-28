# Content-Security-Policy

CrapNote enforces one policy assembled from **two halves**, in two files. This
page says which half owns what, and why the split is where it is — read it
before editing either side.

| Half | Where it lives | Reaches the browser as |
| --- | --- | --- |
| Build-time policy | `frontend/svelte.config.js` (`kit.csp`) | `<meta http-equiv="content-security-policy">` in `index.html` |
| Header policy | `backend/internal/middleware/middleware.go` | `Content-Security-Policy:` response header |

| Directive | Owned by |
| --- | --- |
| `default-src`, `script-src`, `style-src`, `font-src`, `img-src`, `connect-src`, `object-src`, `base-uri`, `form-action` | build-time (meta) |
| `frame-ancestors` | header |

Nothing appears in both. That is the whole design; the rest of this page is why.

## Why two halves

**The header cannot own `script-src`.** The generated `index.html` contains one
inline script, SvelteKit's hydration bootstrap. It embeds a per-build random
global (`__sveltekit_<rand>`) and the content-hashed entry chunk filenames, so
its SHA-256 changes on every frontend build even when no source changed —
building an unmodified tree twice produced `sha256-XFMCpKykyatJXqJNnJs/…` and
then `sha256-Qas1r0MAi0HoQo4KTEtioMlr0yXpuHBayBu7ns65YDY=` (issue #90). A hash
pinned in Go would leave the SPA silently unbootable after the next build, and a
nonce would need the HTML rewritten per request, which the embedded static file
server (`backend/cmd/server/ui.go`) does not do. Only the build knows the hash,
so the build states the policy: `kit.csp` in `mode: 'hash'` computes it and
emits the policy into the HTML. Before that, `script-src` had to carry
`'unsafe-inline'`, which meant CSP did not block XSS execution at all.

**The meta tag cannot own `frame-ancestors`.** Browsers ignore `frame-ancestors`
(along with `report-uri` and `sandbox`) in a meta tag, and SvelteKit strips it
from the meta output rather than emit something inert. With `adapter-static`
there is no SvelteKit server to set a header, so clickjacking protection has to
come from the Go middleware — which is also where `X-Frame-Options: DENY` is
set, and a middleware test asserts the two agree.

## Why nothing is duplicated

When a document has both a header policy and a meta policy, **both are enforced
and a resource must satisfy each**. Restating a directive in the second half can
therefore only intersect — it never tightens anything the stricter half already
covers, and it adds a way to break the app:

- Putting `script-src 'self'` (or a `default-src 'self'` standing in for it)
  back in the header would block the bootstrap the meta tag allowlists, because
  the header cannot name the per-build hash. The SPA would render a blank page.
- Duplicating, say, `font-src` means every future change to it has to be made in
  two files or the app breaks in one browser-visible way and passes both unit
  test suites.

So: **new or changed resource directive → `frontend/svelte.config.js` only.**
The header exists to carry `frame-ancestors` and is expected to stay a single
directive.

## Deliberate exceptions inside the build-time policy

- **`style-src 'unsafe-inline'` stays.** ProseMirror writes `style` attributes
  at runtime and the `app.html` shell uses one; style attributes cannot be
  hash-allowlisted without `'unsafe-hashes'`. Keeping `'unsafe-inline'` also
  stops SvelteKit hashing the inline `<style>` block of theme tokens — once a
  hash is present browsers ignore `'unsafe-inline'` entirely, which would break
  every runtime style attribute.
- **`img-src https:` stays.** The Milkdown NodeView renders whatever `src` a
  note holds as a plain `<img>` (`frontend/src/lib/milkdown/image.ts`), and
  remote srcs legitimately occur: pasted markdown keeps its original URLs, and
  the browser extension hot-links the original when re-uploading an image fails
  (`extension/src/core/images.ts`). Narrowing this to `'self'` would silently
  break images in notes users already have. Images cannot execute script.
- **The Google Fonts origins stay.** `app.html` loads its webfonts from them at
  runtime and every theme's typography depends on those families —
  `style-src` for the stylesheet, `font-src` for the font files.

## No inline scripts in the shell

SvelteKit hashes only the bootstrap it generates itself. Any `<script>` written
inline in `frontend/src/app.html` is copied to the output unhashed and, with no
`'unsafe-inline'`, blocked. The webfont loader therefore lives in
`frontend/static/fonts.js` and is loaded with `<script src>`, covered by
`script-src 'self'`. `src/csp.test.ts` fails if an inline script reappears.

## What the policy still does not do

It is not an exfiltration barrier. CSP has no directive governing top-level
navigation — `navigate-to` was dropped from the spec — so script that does
execute can always navigate away with data in the URL. `img-src https:` and the
allowlisted `https://fonts.googleapis.com` are narrower versions of the same
channel. With `script-src` hashed, the value of the policy is that injected
script does not run in the first place.

## Tests

| What | Where |
| --- | --- |
| Build-time directives (no `unsafe-inline` in `script-src`, off-site allowlist, no inline script in `app.html`) | `frontend/src/csp.test.ts` |
| Header is exactly `frame-ancestors 'none'`, agrees with `X-Frame-Options`, and owns no resource directive | `backend/internal/middleware/middleware_test.go` |
| What the browser enforces: both halves present, injected inline script does not run, booting and editing raise no violations | `e2e/tests/csp.spec.ts` |
