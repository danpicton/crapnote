package main

import (
	"fmt"
	"text/tabwriter"

	"github.com/danpicton/crapnote/cli/client"
)

func cmdTags(e *env, args []string) int {
	if len(args) == 0 {
		return e.usageError("tags: missing subcommand (see 'crapnote help')")
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "list":
		return tagsList(e, rest)
	case "create":
		return tagsCreate(e, rest)
	case "rename":
		return tagsRename(e, rest)
	case "delete":
		return tagsDelete(e, rest)
	default:
		return e.usageError("tags: unknown subcommand %q (see 'crapnote help')", sub)
	}
}

func tagsList(e *env, args []string) int {
	fs := newFlagSet(e, "tags list")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}

	tags, err := e.client.ListTags(e.ctx, *limit, *offset)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(tags)
	}
	printTagsTable(e, tags)
	return exitOK
}

func tagsCreate(e *env, args []string) int {
	fs := newFlagSet(e, "tags create")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) != 1 {
		return e.usageError("usage: crapnote tags create NAME")
	}

	tag, err := e.client.CreateTag(e.ctx, pos[0])
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(tag)
	}
	fmt.Fprintf(e.stdout, "Created tag %d: %s\n", tag.ID, tag.Name)
	return exitOK
}

func tagsRename(e *env, args []string) int {
	fs := newFlagSet(e, "tags rename")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) != 2 {
		return e.usageError("usage: crapnote tags rename TAG_ID NEW_NAME")
	}
	id, err := parseIDArg(pos[0])
	if err != nil {
		return e.usageError("%v", err)
	}

	tag, err := e.client.RenameTag(e.ctx, id, pos[1])
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(tag)
	}
	fmt.Fprintf(e.stdout, "Tag %d renamed to %s.\n", tag.ID, tag.Name)
	return exitOK
}

func tagsDelete(e *env, args []string) int {
	fs := newFlagSet(e, "tags delete")
	id, code, ok := idArg(e, fs, args, "tag")
	if !ok {
		return code
	}
	if err := e.client.DeleteTag(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintf(e.stdout, "Tag %d deleted.\n", id)
	}
	return exitOK
}

// notesTagsList handles 'notes tags NOTE_ID'.
func notesTagsList(e *env, args []string) int {
	fs := newFlagSet(e, "notes tags")
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	tags, err := e.client.NoteTags(e.ctx, id)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(tags)
	}
	printTagsTable(e, tags)
	return exitOK
}

// notesTagOp handles 'notes tag NOTE_ID TAG_ID' (attach=true) and
// 'notes untag NOTE_ID TAG_ID' (attach=false).
func notesTagOp(e *env, args []string, attach bool) int {
	name := "notes tag"
	if !attach {
		name = "notes untag"
	}
	fs := newFlagSet(e, name)
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) != 2 {
		return e.usageError("usage: crapnote %s NOTE_ID TAG_ID", name)
	}
	noteID, err := parseIDArg(pos[0])
	if err != nil {
		return e.usageError("%v", err)
	}
	tagID, err := parseIDArg(pos[1])
	if err != nil {
		return e.usageError("%v", err)
	}

	if attach {
		err = e.client.TagNote(e.ctx, noteID, tagID)
	} else {
		err = e.client.UntagNote(e.ctx, noteID, tagID)
	}
	if err != nil {
		return e.fail(err)
	}
	if !e.json {
		verb := "added to"
		if !attach {
			verb = "removed from"
		}
		fmt.Fprintf(e.stdout, "Tag %d %s note %d.\n", tagID, verb, noteID)
	}
	return exitOK
}

func printTagsTable(e *env, tags []client.Tag) {
	if len(tags) == 0 {
		fmt.Fprintln(e.stdout, "No tags.")
		return
	}
	w := tabwriter.NewWriter(e.stdout, 2, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tNOTES")
	for _, t := range tags {
		fmt.Fprintf(w, "%d\t%s\t%d\n", t.ID, t.Name, t.NoteCount)
	}
	w.Flush() //nolint:errcheck
}
