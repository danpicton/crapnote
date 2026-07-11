package main

import (
	"fmt"
	"strconv"
	"text/tabwriter"

	"github.com/danpicton/crapnote/cli/client"
)

func cmdNotes(e *env, args []string) int {
	if len(args) == 0 {
		return e.usageError("notes: missing subcommand (see 'crapnote help')")
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "list":
		return notesList(e, rest)
	default:
		return e.usageError("notes: unknown subcommand %q (see 'crapnote help')", sub)
	}
}

func notesList(e *env, args []string) int {
	fs := newFlagSet(e, "notes list")
	starred := fs.Bool("starred", false, "only starred notes")
	tagID := fs.Int64("tag", 0, "only notes carrying this tag ID")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	if err := fs.Parse(args); err != nil {
		return exitUsage
	}

	notes, err := e.client.ListNotes(e.ctx, client.ListNotesOptions{
		Starred: *starred,
		TagID:   *tagID,
		Limit:   *limit,
		Offset:  *offset,
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

func printNotesTable(e *env, notes []client.Note) {
	if len(notes) == 0 {
		fmt.Fprintln(e.stdout, "No notes.")
		return
	}
	w := tabwriter.NewWriter(e.stdout, 2, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tFLAGS\tTITLE\tUPDATED")
	for _, n := range notes {
		fmt.Fprintf(w, "%d\t%s\t%s\t%s\n", n.ID, noteFlags(n), n.Title, n.UpdatedAt)
	}
	w.Flush() //nolint:errcheck
}

func noteFlags(n client.Note) string {
	flags := ""
	if n.Pinned {
		flags += "P"
	}
	if n.Starred {
		flags += "*"
	}
	if n.Archived {
		flags += "A"
	}
	if flags == "" {
		flags = "-"
	}
	return flags
}

// parseIDArg parses a positional numeric ID argument.
func parseIDArg(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid ID %q", s)
	}
	return id, nil
}
