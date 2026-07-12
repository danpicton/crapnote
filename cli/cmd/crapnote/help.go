package main

import (
	"fmt"
	"io"
)

// printUsage prints the compact top-level summary. Detailed per-command help
// lives in helpTopics and is reached via 'crapnote help <command>'.
func printUsage(w io.Writer) {
	fmt.Fprint(w, `crapnote — CLI for the CrapNote note-taking API

Usage:
  crapnote [global flags] <command> [subcommand] [flags] [args]

Commands:
  notes    create, list, read, update, delete, star, pin, archive, tag notes
  search   full-text search across notes (server-side FTS5)
  archive  list archived notes
  tags     list, create, rename, delete tags
  trash    list, restore, or permanently delete trashed notes
  export   download all notes and images as a ZIP
  tokens   list and revoke API tokens
  version  print the CLI version
  help     show this summary, or details for one command

Global flags (valid in any position):
  --url URL      server base URL   (env CRAPNOTE_URL, default http://localhost:8080)
  --token TOKEN  cnp_ API token    (env CNP_TOKEN; flag takes precedence)
  --json         structured JSON on stdout, nothing else (default: human-readable)

Exit codes:
  0 success · 1 server/transport error · 2 usage or validation error
  3 authentication failed (401) · 4 forbidden (403) · 5 not found (404)

Run 'crapnote help <command>' for details and examples of any command.
`)
}

// helpTopics maps each top-level command to its detailed help text.
var helpTopics = map[string]string{
	"notes": `Manage notes.

Usage:
  crapnote notes <subcommand> [flags] [args]

Subcommands:
  list [--starred] [--tag TAG_ID] [--limit N] [--offset N]
      List active notes (excludes archived and trashed).
  create --title T [--body B | --body-file F | --body-file -]
      Create a note. Body comes from the flag, a file, or stdin ('-').
  get ID
      Show one note: title, flags, timestamps, body.
  update ID [--title T] [--body B | --body-file F]
      Change title and/or body. Omitted fields are left unchanged.
  delete ID
      Move a note to trash (restorable via 'crapnote trash restore ID').
  star ID | pin ID
      Toggle the starred/pinned flag; prints the new state.
  archive ID | unarchive ID
      Move a note out of / back into the active list.
  tags ID
      List the tags attached to a note.
  tag ID TAG_ID | untag ID TAG_ID
      Attach or detach a tag (create tags with 'crapnote tags create').

Examples:
  crapnote notes create --title "Meeting" --body-file - < notes.md
  crapnote notes list --tag 3 --starred
  crapnote notes get 7 --json
`,
	"search": `Full-text search across notes (server-side, SQLite FTS5).

Usage:
  crapnote search QUERY [--limit N] [--offset N]

Multiple positional words are joined into one query. Pagination flags
match 'notes list' (server default 50, max 100 per page).

Examples:
  crapnote search "quarterly report"
  crapnote search meeting agenda --limit 10 --json | jq '.[].id'
`,
	"archive": `List archived notes.

Usage:
  crapnote archive list [--limit N] [--offset N]

Archive/unarchive individual notes with 'crapnote notes archive ID' and
'crapnote notes unarchive ID'.
`,
	"tags": `Manage tags.

Usage:
  crapnote tags <subcommand> [flags] [args]

Subcommands:
  list [--limit N] [--offset N]   List tags with note counts.
  create NAME                     Create a tag.
  rename TAG_ID NEW_NAME          Rename a tag.
  delete TAG_ID                   Delete a tag (detaches it from all notes).

Attach/detach tags on a note with 'crapnote notes tag ID TAG_ID' and
'crapnote notes untag ID TAG_ID'.
`,
	"trash": `Manage trashed notes. Notes are auto-purged ~7 days after deletion.

Usage:
  crapnote trash <subcommand> [flags] [args]

Subcommands:
  list [--limit N] [--offset N]   List trashed notes with purge deadlines.
  restore NOTE_ID                 Move a note back out of trash.
  purge NOTE_ID --yes             Permanently delete one note (irreversible).
  empty --yes                     Permanently delete everything in trash.

Irreversible subcommands refuse to run without --yes.
`,
	"export": `Download all notes and images as a ZIP archive.

Usage:
  crapnote export [-o FILE] [--password P]

Flags:
  -o FILE       Output path (default crapnote-export-YYYY-MM-DD.zip).
  --password P  Encrypt the ZIP with this password.

Prefer the env var CNP_EXPORT_PASSWORD over --password: flags are visible
in process listings and shell history.
`,
	"tokens": `List and revoke API tokens.

Usage:
  crapnote tokens <subcommand> [flags] [args]

Subcommands:
  list                List your tokens (metadata only, never the secret).
  revoke TOKEN_ID     Revoke one token.
  revoke-all --yes    Revoke every token, including the one in use.

Tokens cannot be created from the CLI by design: the API only mints tokens
over a browser session. Create one in the web UI under Settings → Developer
(scope "read" or "read_write"), then pass it via CNP_TOKEN or --token.
`,
	"version": `Print the CLI version.

Usage:
  crapnote version [--json]

Human output is a single line; --json emits version, commit, build date,
and Go version as a JSON object.
`,
	"help": `Show help.

Usage:
  crapnote help             Top-level command summary.
  crapnote help <command>   Details and examples for one command.

'crapnote <command> --help' and 'crapnote <command> help' show the same
per-command details.
`,
}

// printTopicHelp writes detailed help for topic. Returns false if the topic
// is unknown.
func printTopicHelp(w io.Writer, topic string) bool {
	text, ok := helpTopics[topic]
	if !ok {
		return false
	}
	fmt.Fprint(w, text)
	return true
}

// topicUsageError reports a bad invocation of a command and follows it with
// that command's detailed help on stderr.
func (e *env) topicUsageError(topic, format string, a ...any) int {
	fmt.Fprintf(e.stderr, "crapnote: "+format+"\n\n", a...)
	printTopicHelp(e.stderr, topic)
	return exitUsage
}

// isHelpArg reports whether a subcommand argument is a request for help,
// so 'crapnote notes help' and 'crapnote notes --help' both work.
func isHelpArg(s string) bool {
	return s == "help" || s == "--help" || s == "-h"
}
