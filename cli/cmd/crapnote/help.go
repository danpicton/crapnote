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

Commands:
  notes list [--starred] [--tag ID] [--limit N] [--offset N]
                                        list active notes
Exit codes:
  0 success · 1 server/transport error · 2 usage or validation error
  3 authentication failed (401) · 4 forbidden, e.g. read-only token (403)
  5 not found (404)

Create an API token in the web UI under Settings → Developer (scope "read"
or "read_write"). Tokens cannot be created from the CLI by design.
`)
}
