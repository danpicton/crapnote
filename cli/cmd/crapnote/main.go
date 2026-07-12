// Command crapnote is a CLI for the CrapNote REST API.
//
// It is a thin frontend over the client package: command/flag parsing and
// output formatting live here; all HTTP logic lives in client.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/danpicton/crapnote/cli/client"
)

const defaultURL = "http://localhost:8080"

// Exit codes. Distinct codes let scripts and agents branch on failure class
// without parsing stderr.
const (
	exitOK        = 0
	exitError     = 1 // transport or server error
	exitUsage     = 2 // bad arguments or HTTP 400 validation failure
	exitAuth      = 3 // HTTP 401 — missing/invalid token
	exitForbidden = 4 // HTTP 403 — e.g. write with a read-only token
	exitNotFound  = 5 // HTTP 404
)

func main() {
	os.Exit(runStdin(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, os.Getenv))
}

// env carries everything a command needs: resolved config, output streams,
// and the API client.
type env struct {
	url    string
	token  string
	json   bool
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
	getenv func(string) string
	client *client.Client
	ctx    context.Context
}

// run is the testable entrypoint: args (without argv[0]) in, exit code out.
func run(args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	return runStdin(args, strings.NewReader(""), stdout, stderr, getenv)
}

func runStdin(args []string, stdin io.Reader, stdout, stderr io.Writer, getenv func(string) string) int {
	e := &env{
		url:    getenv("CRAPNOTE_URL"),
		token:  getenv("CNP_TOKEN"),
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		getenv: getenv,
		ctx:    context.Background(),
	}
	if e.url == "" {
		e.url = defaultURL
	}

	// Global flags may appear before the command; they are also re-registered
	// on every subcommand FlagSet so they work in any position.
	top := newFlagSet(e, "crapnote")
	topVersion := top.Bool("version", false, "print the CLI version and exit")
	top.Usage = func() { printUsage(stderr) }
	if err := top.Parse(args); err != nil {
		return parseCode(err)
	}
	if *topVersion {
		return cmdVersion(e, nil)
	}
	rest := top.Args()
	if len(rest) == 0 {
		printUsage(stderr)
		return exitUsage
	}

	cmd, rest := rest[0], rest[1:]
	if isHelpArg(cmd) {
		return cmdHelp(e, rest)
	}

	dispatch, ok := commands[cmd]
	if !ok {
		fmt.Fprintf(stderr, "crapnote: unknown command %q\n\n", cmd)
		printUsage(stderr)
		return exitUsage
	}
	e.client = client.New(e.url, e.token)
	return dispatch(e, rest)
}

// commands maps a top-level command to its dispatcher.
var commands = map[string]func(*env, []string) int{
	"notes":   cmdNotes,
	"search":  cmdSearch,
	"archive": cmdArchive,
	"tags":    cmdTags,
	"trash":   cmdTrash,
	"export":  cmdExport,
	"tokens":  cmdTokens,
	"version": cmdVersion,
}

// cmdHelp implements 'crapnote help [command]': the top-level summary with
// no argument, detailed per-command help with one.
func cmdHelp(e *env, args []string) int {
	if len(args) == 0 {
		printUsage(e.stdout)
		return exitOK
	}
	if printTopicHelp(e.stdout, args[0]) {
		return exitOK
	}
	fmt.Fprintf(e.stderr, "crapnote: unknown help topic %q\n\n", args[0])
	printUsage(e.stderr)
	return exitUsage
}

// newFlagSet creates a FlagSet with the global flags bound to e. Defaults are
// e's current values, so flag > env var > default precedence falls out of
// ordinary parsing.
func newFlagSet(e *env, name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(e.stderr)
	fs.StringVar(&e.url, "url", e.url, "CrapNote server base URL (env CRAPNOTE_URL)")
	fs.StringVar(&e.token, "token", e.token, "API token (env CNP_TOKEN); never logged")
	fs.BoolVar(&e.json, "json", e.json, "emit structured JSON on stdout, nothing else")
	fs.Usage = func() {
		fmt.Fprintf(e.stderr, "Usage: crapnote %s [flags] [args]\n\nFlags:\n", name)
		fs.PrintDefaults()
	}
	return fs
}

// parseCode maps a FlagSet parse error to an exit code: --help is success,
// anything else is a usage error.
func parseCode(err error) int {
	if errors.Is(err, flag.ErrHelp) {
		return exitOK
	}
	return exitUsage
}

// parseInterspersed parses fs but, unlike stdlib flag, allows flags to appear
// after positional arguments ("crapnote notes get 7 --json"). Returns the
// positional arguments in order.
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		rest := fs.Args()
		if len(rest) == 0 {
			return positional, nil
		}
		positional = append(positional, rest[0])
		args = rest[1:]
	}
}

// fail prints err to stderr and maps it to an exit code.
func (e *env) fail(err error) int {
	fmt.Fprintf(e.stderr, "crapnote: %v\n", err)
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusBadRequest:
			return exitUsage
		case http.StatusUnauthorized:
			return exitAuth
		case http.StatusForbidden:
			return exitForbidden
		case http.StatusNotFound:
			return exitNotFound
		}
	}
	return exitError
}

// usageError reports a local argument error (never an API call).
func (e *env) usageError(format string, a ...any) int {
	fmt.Fprintf(e.stderr, "crapnote: "+format+"\n", a...)
	return exitUsage
}

// emitJSON writes v as indented JSON — the only stdout output in --json mode.
func (e *env) emitJSON(v any) int {
	enc := json.NewEncoder(e.stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return e.fail(err)
	}
	return exitOK
}
