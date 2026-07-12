package main

import (
	"strings"

	"github.com/danpicton/crapnote/cli/client"
)

// cmdSearch full-text-searches notes (FTS5 on the server). Multiple
// positional words are joined into one query.
func cmdSearch(e *env, args []string) int {
	fs := newFlagSet(e, "search")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) == 0 {
		return e.usageError("search: missing query (usage: crapnote search QUERY)")
	}

	notes, err := e.client.ListNotes(e.ctx, client.ListNotesOptions{
		Search: strings.Join(pos, " "),
		Limit:  *limit,
		Offset: *offset,
	})
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(notes)
	}
	printNotesTable(e, notes)
	return exitOK
}

// cmdArchive lists archived notes.
func cmdArchive(e *env, args []string) int {
	if len(args) == 0 || args[0] != "list" {
		return e.usageError("archive: expected 'list' subcommand")
	}
	fs := newFlagSet(e, "archive list")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	if _, err := parseInterspersed(fs, args[1:]); err != nil {
		return parseCode(err)
	}

	notes, err := e.client.ListArchived(e.ctx, *limit, *offset)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(notes)
	}
	printNotesTable(e, notes)
	return exitOK
}
