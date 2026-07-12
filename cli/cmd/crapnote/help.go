package main

import (
	"fmt"
	"io"
)

func printUsage(w io.Writer) {
	fmt.Fprint(w, `crapnote — CLI for the CrapNote note-taking API

Usage:
  crapnote [global flags] <command> [subcommand] [flags] [args]

Global flags (valid in any position):
  --url URL      server base URL      (env CRAPNOTE_URL, default http://localhost:8080)
  --token TOKEN  cnp_ API token       (env CNP_TOKEN; flag takes precedence)
  --json         structured JSON on stdout, nothing else (default: human-readable)

Notes:
  notes list [--starred] [--tag ID] [--limit N] [--offset N]   list active notes
  notes create --title T [--body B | --body-file F | --body-file -]
                                       create a note (body from flag, file, or stdin)
  notes get ID                         show one note (title, flags, body)
  notes update ID [--title T] [--body B | --body-file F]       change title and/or body
  notes delete ID                      move a note to trash (restorable)
  notes star ID | notes pin ID         toggle starred/pinned flag
  notes archive ID | notes unarchive ID
  notes tags ID                        list tags on a note
  notes tag ID TAG_ID | notes untag ID TAG_ID                  attach/detach a tag

Search (server-side full-text search, FTS5):
  search QUERY [--limit N] [--offset N]

Archive:
  archive list [--limit N] [--offset N]

Tags:
  tags list [--limit N] [--offset N]   list tags with note counts
  tags create NAME
  tags rename TAG_ID NEW_NAME
  tags delete TAG_ID

Trash (notes are auto-purged ~7 days after deletion):
  trash list                           list trashed notes with purge deadline
  trash restore NOTE_ID
  trash purge NOTE_ID --yes            permanently delete one note (irreversible)
  trash empty --yes                    permanently delete everything in trash

Export:
  export [-o FILE] [--password P]      download all notes + images as a ZIP
    Prefer env CNP_EXPORT_PASSWORD over --password: flags are visible in
    process listings and shell history.

API tokens:
  tokens list                          list your tokens (metadata only)
  tokens revoke TOKEN_ID
  tokens revoke-all --yes              revoke every token, including this one

Examples:
  export CNP_TOKEN=cnp_xxx
  crapnote notes create --title "Meeting" --body-file - < notes.md
  crapnote search "quarterly report" --json | jq '.[].id'
  crapnote notes list --tag 3 --starred

Exit codes:
  0 success · 1 server/transport error · 2 usage or validation error
  3 authentication failed (401) · 4 forbidden, e.g. read-only token (403)
  5 not found (404)

Create an API token in the web UI under Settings → Developer (scope "read"
or "read_write"). Tokens cannot be created from the CLI by design: the API
only mints tokens over a browser session.
`)
}
