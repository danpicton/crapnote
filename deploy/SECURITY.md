# Deployment security hardening

Operational guidance that lives outside the application itself. These mitigations
address threats that cannot be handled at the application layer alone.

## 1. Disk / volume encryption (issue #24)

CrapNote stores note content, images (as BLOBs in SQLite), and session tokens
in a single database file. The primary at-rest threat is an attacker who
obtains a copy of that file — a stolen backup, a compromised storage volume, or
unauthorised access to the hosting provider's infrastructure.

**The application does not (and should not) encrypt its own data.** See issue
#24 for the rationale: application-level encryption destroys full-text search
and introduces difficult key management, while the problem it solves is
addressed more simply at the OS/volume layer.

Choose an encryption option appropriate to your deployment:

- **LUKS** on the partition that holds `DATABASE_PATH` (bare metal / VM).
- **Docker volume encryption** — mount an already-encrypted host volume
  into the container rather than using a plain bind mount.
- **Encrypted EBS / persistent disk** on AWS / GCP / Azure. All three
  providers now enable this by default for new volumes.
- **Kubernetes**: set `storageClassName` on the PVC in `deploy/k8s/pvc.yaml`
  to a class backed by an encrypted disk type.

With volume encryption in place the SQLite file at `DATABASE_PATH` is
transparently protected against offline theft. FTS5 continues to work; no
application changes are required.

## 2. Other mitigations already in the app

The following are enforced in code and do not need operator configuration:

- **Login rate limiting** — per-IP token bucket on `POST /api/auth/login`
  (issue #12). Trip threshold can be tuned via the limiter in
  `cmd/server/main.go`.
- **Image upload throttling** — per-user rate limit and storage quota
  (issue #15). Tunable via `IMAGE_UPLOADS_PER_MINUTE` and `IMAGE_QUOTA_MB`
  environment variables.
- **Pagination** — all list endpoints enforce a maximum page size
  (issue #18). Max is 100 items per request.
- **Content-Security-Policy** — enforced as two halves (issues #45, #90), so
  auditing the response headers alone will understate it. The **header**, set by
  `SecurityHeaders` (`internal/middleware`) on every response alongside
  `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, carries one
  directive: `frame-ancestors 'none'`, backing up `X-Frame-Options`. Everything
  else is baked into `index.html` by the frontend build as
  `<meta http-equiv="content-security-policy">` — `default-src 'self'`,
  `script-src` with the build's own hash for SvelteKit's inline bootstrap and no
  `'unsafe-inline'`, `connect-src`/`form-action` first-party (closing the
  scripted-request and form-submission channels: fetch, XHR, WebSocket,
  `sendBeacon`, auto-submitted forms), and `object-src`/`base-uri` `none`.
  `'unsafe-eval'` is never granted. Browsers enforce both halves at once and a
  resource must satisfy each; nothing is duplicated between them. See
  `docs/csp.md` — an operator or reverse proxy that adds resource directives of
  its own will intersect with the built policy and can stop the app booting.

  **It is not an exfiltration barrier.** CSP has no directive covering
  top-level navigation (`navigate-to` was dropped from the spec and never
  shipped), so script that does execute can still navigate the page to an
  attacker URL with data in the query string; the allowlisted
  `https://fonts.googleapis.com` in `style-src` is a second, narrower channel.
  `img-src` also permits any `https:` origin, because notes legitimately contain
  remote images — markdown pasted from elsewhere, and the browser extension's
  fallback of hot-linking an original URL when re-upload fails — and images
  cannot execute script. `style-src` keeps `'unsafe-inline'`: ProseMirror writes
  `style` attributes at runtime, and those cannot be hash-allowlisted without
  `'unsafe-hashes'`. With `script-src` hashed, the policy's value is that
  injected script does not run at all, not that it cannot phone home.

  Apart from images, the only named off-origin hosts are
  `https://fonts.googleapis.com` and `https://fonts.gstatic.com`, for the
  webfonts `app.html` loads at runtime. **If you
  deploy somewhere those hosts are unreachable** (air-gapped networks, or an
  egress allowlist), the app still works — webfonts are progressive
  enhancement and the themes fall back to system faces.
