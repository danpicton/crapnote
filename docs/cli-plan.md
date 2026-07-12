# CrapNote CLI — plan

A thin Go CLI (`crapnote`) over the existing REST API, for humans and AI
agents. Pure HTTP client: no server code, no DB, no CGO.

## Placement

Separate top-level module `cli/` (`github.com/danpicton/crapnote/cli`).

Rationale: the existing module's `go.mod` lives in `backend/`, but its module
path is the repo root — so `go install github.com/danpicton/crapnote/cmd/crapnote@latest`
can never resolve. A `cli/` module at `github.com/danpicton/crapnote/cli`
matches its directory, so `go install github.com/danpicton/crapnote/cli/cmd/crapnote@latest`
works. It also keeps the CLI free of the server's `sqlite_fts5`/CGO build
constraints: `CGO_ENABLED=0 go build` produces a static cross-compilable binary.

```
cli/
├── go.mod                 # module github.com/danpicton/crapnote/cli — stdlib only
├── client/                # reusable typed API client (future MCP server reuses this)
└── cmd/crapnote/          # thin CLI: flag parsing, output formatting, exit codes
```

## Config & auth

- Token: `--token` flag > `CNP_TOKEN` env. Never printed or logged.
- Base URL: `--url` flag > `CRAPNOTE_URL` env > `http://localhost:8080`.
- Requests send `Authorization: Bearer <token>`; the server's 401/403 bodies
  (`{"error":"…"}`) are surfaced verbatim on stderr.

## Command surface → real endpoints

| Command | Endpoint |
|---|---|
| `notes list [--starred] [--tag ID] [--limit N] [--offset N]` | `GET /api/notes` |
| `notes create --title T [--body B \| --body-file F \| -]` | `POST /api/notes` |
| `notes get ID` | `GET /api/notes/{id}` |
| `notes update ID [--title T] [--body B \| --body-file F]` | `PUT /api/notes/{id}` |
| `notes delete ID` (moves to trash) | `DELETE /api/notes/{id}` |
| `notes star ID` / `notes pin ID` (toggles) | `PATCH /api/notes/{id}/star` / `…/pin` |
| `notes archive ID` / `notes unarchive ID` | `PATCH /api/notes/{id}/archive` / `…/unarchive` |
| `archive list` | `GET /api/archive` |
| `search QUERY` | `GET /api/notes?search=…` (FTS5 — no separate endpoint) |
| `notes tags ID` / `notes tag ID TAG_ID` / `notes untag ID TAG_ID` | `GET/POST /api/notes/{id}/tags`, `DELETE …/tags/{tid}` |
| `tags list` / `tags create NAME` / `tags rename ID NAME` / `tags delete ID` | `/api/tags…` |
| `trash list` / `trash restore ID` / `trash purge ID --yes` / `trash empty --yes` | `/api/trash…` |
| `export [-o FILE] [--password P]` (or env `CNP_EXPORT_PASSWORD`) | `POST /api/export` (ZIP stream) |
| `tokens list` / `tokens revoke ID` / `tokens revoke-all --yes` | `/api/tokens…` |

Irreversible commands (`trash purge`, `trash empty`, `tokens revoke-all`)
require `--yes`, mirroring the web UI's confirm dialogs. The export password
can come from `CNP_EXPORT_PASSWORD` so it stays out of `ps` output and shell
history.

Token **creation** is deliberately unsupported: the server only mints tokens
over a cookie session (`cookieOnly` in `backend/cmd/server/server.go`), so the
CLI explains that instead of failing cryptically.

## Output & exit codes

- `--json` on every command: structured JSON on stdout, nothing else.
- Default: human-readable tables/summaries. Errors always to stderr.
- Exit codes: `0` success · `1` server/transport error · `2` usage/validation
  (incl. HTTP 400) · `3` auth failure (401) · `4` forbidden (403, e.g.
  read-only token write) · `5` not found (404).

## Process

Strict TDD, vertical slices, one behaviour per red→green cycle, commit per
green slice. Client tested through exported methods against `httptest.Server`
with canned API responses; CLI tested command-invocation → stdout/stderr/exit
code. No mocks of `http.Client` internals.

Build/test wiring: root `Makefile` gains `build-cli` (static, CGO_ENABLED=0)
and `test-cli`; `test-cli` joins the `ci` target.
