package main

import (
	"fmt"
	"os"
	"text/tabwriter"
	"time"
)

func cmdTrash(e *env, args []string) int {
	if len(args) == 0 {
		return e.usageError("trash: missing subcommand (see 'crapnote help')")
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "list":
		return trashList(e, rest)
	case "restore":
		return trashRestore(e, rest)
	case "purge":
		return trashPurge(e, rest)
	case "empty":
		return trashEmpty(e, rest)
	default:
		return e.usageError("trash: unknown subcommand %q (see 'crapnote help')", sub)
	}
}

func trashList(e *env, args []string) int {
	fs := newFlagSet(e, "trash list")
	limit := fs.Int("limit", 0, "page size (server default 50, max 100)")
	offset := fs.Int("offset", 0, "page offset")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}

	entries, err := e.client.ListTrash(e.ctx, *limit, *offset)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(entries)
	}
	if len(entries) == 0 {
		fmt.Fprintln(e.stdout, "Trash is empty.")
		return exitOK
	}
	w := tabwriter.NewWriter(e.stdout, 2, 4, 2, ' ', 0)
	fmt.Fprintln(w, "NOTE ID\tTITLE\tDELETED\tPURGED AT")
	for _, en := range entries {
		fmt.Fprintf(w, "%d\t%s\t%s\t%s\n", en.NoteID, en.Title, en.DeletedAt, en.PermanentDeleteAt)
	}
	w.Flush() //nolint:errcheck
	return exitOK
}

func trashRestore(e *env, args []string) int {
	fs := newFlagSet(e, "trash restore")
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	if err := e.client.RestoreNote(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintf(e.stdout, "Note %d restored from trash.\n", id)
	}
	return exitOK
}

func trashPurge(e *env, args []string) int {
	fs := newFlagSet(e, "trash purge")
	id, code, ok := idArg(e, fs, args, "note")
	if !ok {
		return code
	}
	if err := e.client.PurgeNote(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintf(e.stdout, "Note %d permanently deleted.\n", id)
	}
	return exitOK
}

func trashEmpty(e *env, args []string) int {
	fs := newFlagSet(e, "trash empty")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}
	if err := e.client.EmptyTrash(e.ctx); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintln(e.stdout, "Trash emptied — all trashed notes permanently deleted.")
	}
	return exitOK
}

// cmdExport downloads the notes+images ZIP export.
func cmdExport(e *env, args []string) int {
	fs := newFlagSet(e, "export")
	out := fs.String("o", "", "output file (default crapnote-export-YYYY-MM-DD.zip)")
	password := fs.String("password", "", "encrypt the ZIP with this password")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}

	path := *out
	if path == "" {
		path = fmt.Sprintf("crapnote-export-%s.zip", time.Now().UTC().Format("2006-01-02"))
	}
	f, err := os.Create(path)
	if err != nil {
		return e.fail(err)
	}
	if err := e.client.Export(e.ctx, *password, f); err != nil {
		f.Close()           //nolint:errcheck,gosec
		_ = os.Remove(path) // don't leave a partial archive behind
		return e.fail(err)
	}
	if err := f.Close(); err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(map[string]string{"file": path})
	}
	fmt.Fprintf(e.stdout, "Export written to %s\n", path)
	return exitOK
}

// cmdTokens manages the caller's API tokens. Creation is deliberately
// unsupported: the server only mints tokens over a cookie session.
func cmdTokens(e *env, args []string) int {
	if len(args) == 0 {
		return e.usageError("tokens: missing subcommand (see 'crapnote help')")
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "list":
		return tokensList(e, rest)
	case "revoke":
		return tokensRevoke(e, rest)
	case "revoke-all":
		return tokensRevokeAll(e, rest)
	case "create":
		return e.usageError("tokens create: the API only mints tokens over a browser session — " +
			"create one in the web UI under Settings → Developer, then pass it via CNP_TOKEN or --token")
	default:
		return e.usageError("tokens: unknown subcommand %q (see 'crapnote help')", sub)
	}
}

func tokensList(e *env, args []string) int {
	fs := newFlagSet(e, "tokens list")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}
	tokens, err := e.client.ListTokens(e.ctx)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(tokens)
	}
	if len(tokens) == 0 {
		fmt.Fprintln(e.stdout, "No API tokens.")
		return exitOK
	}
	w := tabwriter.NewWriter(e.stdout, 2, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tPREFIX\tSCOPE\tEXPIRES\tREVOKED")
	for _, tok := range tokens {
		fmt.Fprintf(w, "%d\t%s\t%s\t%s\t%s\t%s\n",
			tok.ID, tok.Name, tok.Prefix, tok.Scope, orDash(tok.ExpiresAt), orDash(tok.RevokedAt))
	}
	w.Flush() //nolint:errcheck
	return exitOK
}

func orDash(s *string) string {
	if s == nil || *s == "" {
		return "-"
	}
	return *s
}

func tokensRevoke(e *env, args []string) int {
	fs := newFlagSet(e, "tokens revoke")
	id, code, ok := idArg(e, fs, args, "token")
	if !ok {
		return code
	}
	if err := e.client.RevokeToken(e.ctx, id); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintf(e.stdout, "Token %d revoked.\n", id)
	}
	return exitOK
}

func tokensRevokeAll(e *env, args []string) int {
	fs := newFlagSet(e, "tokens revoke-all")
	if _, err := parseInterspersed(fs, args); err != nil {
		return parseCode(err)
	}
	if err := e.client.RevokeAllTokens(e.ctx); err != nil {
		return e.fail(err)
	}
	if !e.json {
		fmt.Fprintln(e.stdout, "All API tokens revoked — including the one used for this request.")
	}
	return exitOK
}
