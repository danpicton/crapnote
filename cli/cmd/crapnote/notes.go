package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"text/tabwriter"

	"github.com/danpicton/crapnote/cli/client"
)

func cmdNotes(e *env, args []string) int {
	if len(args) == 0 {
		return e.topicUsageError("notes", "notes: missing subcommand")
	}
	sub, rest := args[0], args[1:]
	if isHelpArg(sub) {
		printTopicHelp(e.stdout, "notes")
		return exitOK
	}
	switch sub {
	case "list":
		return notesList(e, rest)
	case "create":
		return notesCreate(e, rest)
	case "get":
		return notesGet(e, rest)
	case "update":
		return notesUpdate(e, rest)
	case "delete":
		return notesDelete(e, rest)
	case "star":
		return notesToggle(e, rest, "star")
	case "pin":
		return notesToggle(e, rest, "pin")
	case "lock":
		return notesToggle(e, rest, "lock")
	case "archive":
		return notesArchiveOp(e, rest, true)
	case "unarchive":
		return notesArchiveOp(e, rest, false)
	case "tags":
		return notesTagsList(e, rest)
	case "tag":
		return notesTagOp(e, rest, true)
	case "untag":
		return notesTagOp(e, rest, false)
	default:
		return e.topicUsageError("notes", "notes: unknown subcommand %q", sub)
	}
}

// idArg parses flags then requires exactly one positional ID.
func idArg(e *env, fs *flag.FlagSet, args []string, what string) (int64, int, bool) {
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 0, parseCode(err), false
	}
	if len(pos) != 1 {
		return 0, e.usageError("expected exactly one %s ID argument", what), false
	}
	id, err := parseIDArg(pos[0])
	if err != nil {
		return 0, e.usageError("%v", err), false
	}
	return id, 0, true
}

func notesCreate(e *env, args []string) int {
	fs := newFlagSet(e, "notes create")
	title := fs.String("title", "", "note title (required)")
	body := fs.String("body", "", "note body (markdown)")
	bodyFile := fs.String("body-file", "", "read body from file, or '-' for stdin")
	if err := fs.Parse(args); err != nil {
		return parseCode(err)
	}
	if *title == "" {
		return e.usageError("notes create: --title is required")
	}
	b, code, ok := resolveBody(e, *body, *bodyFile)
	if !ok {
		return code
	}

	note, err := e.client.CreateNote(e.ctx, *title, b)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(note)
	}
	fmt.Fprintf(e.stdout, "Created note %d: %s\n", note.ID, note.Title)
	return exitOK
}

// resolveBody returns the note body from --body, --body-file, or stdin ('-').
func resolveBody(e *env, body, bodyFile string) (string, int, bool) {
	if body != "" && bodyFile != "" {
		return "", e.usageError("--body and --body-file are mutually exclusive"), false
	}
	if bodyFile == "" {
		return body, 0, true
	}
	var data []byte
	var err error
	if bodyFile == "-" {
		data, err = io.ReadAll(e.stdin)
	} else {
		data, err = os.ReadFile(bodyFile)
	}
	if err != nil {
		return "", e.usageError("reading body: %v", err), false
	}
	return string(data), 0, true
}

func notesGet(e *env, args []string) int {
	fs := newFlagSet(e, "notes get")
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	note, err := e.client.GetNote(e.ctx, id)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(note)
	}
	fmt.Fprintf(e.stdout, "# %s  [id %d, flags %s]\ncreated %s · updated %s\n\n%s\n",
		note.Title, note.ID, noteFlags(*note), note.CreatedAt, note.UpdatedAt, note.Body)
	return exitOK
}

func notesUpdate(e *env, args []string) int {
	fs := newFlagSet(e, "notes update")
	title := fs.String("title", "", "new title")
	body := fs.String("body", "", "new body (markdown)")
	bodyFile := fs.String("body-file", "", "read new body from file, or '-' for stdin")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) != 1 {
		return e.usageError("expected exactly one note ID argument")
	}
	id, err := parseIDArg(pos[0])
	if err != nil {
		return e.usageError("%v", err)
	}

	var titlePtr, bodyPtr *string
	visited := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { visited[f.Name] = true })
	if visited["title"] {
		titlePtr = title
	}
	if visited["body"] || visited["body-file"] {
		b, code, ok := resolveBody(e, *body, *bodyFile)
		if !ok {
			return code
		}
		bodyPtr = &b
	}
	if titlePtr == nil && bodyPtr == nil {
		return e.usageError("notes update: provide --title and/or --body/--body-file")
	}

	note, err := e.client.UpdateNote(e.ctx, id, titlePtr, bodyPtr)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(note)
	}
	fmt.Fprintf(e.stdout, "Updated note %d: %s\n", note.ID, note.Title)
	return exitOK
}

func notesDelete(e *env, args []string) int {
	fs := newFlagSet(e, "notes delete")
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	if err := e.client.DeleteNote(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintf(e.stdout, "Note %d moved to trash (restorable via 'crapnote trash restore %d').\n", id, id)
	}
	return exitOK
}

func notesToggle(e *env, args []string, action string) int {
	fs := newFlagSet(e, "notes "+action)
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	var note *client.Note
	var err error
	switch action {
	case "star":
		note, err = e.client.ToggleStar(e.ctx, id)
	case "pin":
		note, err = e.client.TogglePin(e.ctx, id)
	default:
		note, err = e.client.ToggleLock(e.ctx, id)
	}
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(note)
	}
	state := map[bool]string{true: "now", false: "no longer"}
	switch action {
	case "star":
		fmt.Fprintf(e.stdout, "Note %d is %s starred.\n", note.ID, state[note.Starred])
	case "pin":
		fmt.Fprintf(e.stdout, "Note %d is %s pinned.\n", note.ID, state[note.Pinned])
	default:
		fmt.Fprintf(e.stdout, "Note %d is %s locked.\n", note.ID, state[note.Locked])
	}
	return exitOK
}

func notesArchiveOp(e *env, args []string, archive bool) int {
	name, op := "notes archive", e.client.ArchiveNote
	if !archive {
		name, op = "notes unarchive", e.client.UnarchiveNote
	}
	fs := newFlagSet(e, name)
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	if err := op(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		if archive {
			fmt.Fprintf(e.stdout, "Note %d archived.\n", id)
		} else {
			fmt.Fprintf(e.stdout, "Note %d unarchived.\n", id)
		}
	}
	return exitOK
}

func notesList(e *env, args []string) int {
	fs := newFlagSet(e, "notes list")
	starred := fs.Bool("starred", false, "only starred notes")
	tagID := fs.Int64("tag", 0, "only notes carrying this tag ID")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	if err := fs.Parse(args); err != nil {
		return parseCode(err)
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
	if n.Locked {
		flags += "L"
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
