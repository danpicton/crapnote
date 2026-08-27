# CrapNote MCP server

CrapNote ships a built-in [MCP](https://modelcontextprotocol.io) (Model
Context Protocol) server so AI agents — Claude Code, Claude Desktop (via a
Streamable HTTP-capable client), and anything else that speaks MCP — can
work with your notes directly.

## Endpoint & auth

- **URL**: `POST /mcp` on the same server that serves the app
  (e.g. `https://notes.example.com/mcp`).
- **Transport**: Streamable HTTP, stateless (single JSON responses; no
  sessions, no server-initiated SSE stream).
- **Auth**: the same bearer API tokens as the REST API. Create one in the
  web UI under Settings → Developer, then send it as
  `Authorization: Bearer cnp_…`. A `read`-scoped token gets a read-only MCP
  surface; `read_write` unlocks the mutating tools. Unauthenticated
  requests get 401.

Claude Code setup:

```bash
claude mcp add --transport http crapnote https://notes.example.com/mcp \
  --header "Authorization: Bearer cnp_yourtoken"
```

## What it exposes

One tool per bearer-reachable API operation — notes CRUD, star/pin/lock,
pin reordering, archive, tags, note–tag associations, trash, export
(base64 ZIP), image upload/fetch, `auth_me`, and token list/revoke. Tool
names are the operation names from the API contract (`notes_list`,
`tags_create`, `trash_empty`, …).

Deliberately absent, mirroring the API's own security posture:

- **Token creation and password change** — cookie-session-only endpoints
  (`cookieOnly` in `backend/cmd/server/server.go`); a leaked token must
  not mint tokens or hijack the account.
- **Admin endpoints** — `auth.RequireAdmin` rejects bearer tokens even for
  admin users, so they cannot appear here either.
- **`auth_logout`** — waived: bearer tokens have no session to end.

## How it works (and why it can't drift)

The MCP server (`backend/internal/mcp`) does not reimplement any API
behaviour. Its tool list is generated from the apispec registry
(`backend/internal/apispec`), and each tool call is replayed as a real HTTP
request through the server's own mux, carrying the caller's verified identity
on the request context (the credential is checked once, at `/mcp`).
Auth, token scopes, cookie-only gates, rate limits, and validation are all
applied by the same middleware and handlers the REST API uses — the MCP
surface *cannot* permit anything the API does not.

## Keeping API, CLI, and MCP aligned

The apispec registry is the single source of truth for the API surface:

1. **API** — `newMux` registers every `/api` route *from* the registry and
   panics on startup (and in every test that builds a mux) if an operation
   lacks a handler binding or vice versa. Middleware wrapping (auth
   scope, admin, cookie-only, rate limiting) derives from registry
   metadata.
2. **MCP** — tools are generated from the registry
   (`apispec.MCPOps()`), so a new bearer-reachable operation becomes a
   tool automatically; excluding one requires an explicit `MCPWaived`
   reason, which a test enforces.
3. **CLI** — the CLI is a separate Go module and can't import the
   registry, so the registry is exported as a machine-readable contract at
   `docs/api-contract.json` (regenerate with `make apispec` in
   `backend/`; a backend test fails while it's stale). The CLI's parity
   test (`cli/cmd/crapnote/parity_test.go`) reads that file and fails
   unless every bearer-reachable operation is either mapped to a CLI
   command or waived with a reason.

Net effect: adding an API endpoint starts by declaring it in
`backend/internal/apispec/spec.go`. The compiler and tests then force a
handler binding, an MCP decision (automatic tool or explicit waiver), a
regenerated contract file, and a CLI decision (command or explicit
waiver). Silent divergence between the three surfaces fails CI.
