package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

// cliCoverage maps every bearer-reachable API operation (by its apispec
// name) to the CLI command that exercises it, or to a waiver explaining why
// the CLI deliberately does not. The parity test fails when the API
// contract (docs/api-contract.json, generated from the backend's apispec
// registry via `make apispec`) gains a bearer-reachable operation that is
// neither covered nor waived — that is the alignment mechanism: extending
// the API forces an explicit CLI decision here.
var cliCoverage = map[string]struct {
	command string // the CLI invocation covering the op ("" if waived)
	waived  string // reason the op is deliberately not a CLI command
}{
	"auth_logout":       {waived: "logout ends a cookie session; the CLI authenticates per-request with a token"},
	"auth_me":           {command: "whoami"},
	"tokens_list":       {command: "tokens list"},
	"tokens_revoke":     {command: "tokens revoke"},
	"tokens_revoke_all": {command: "tokens revoke-all"},

	"notes_list":         {command: "notes list / search"},
	"notes_create":       {command: "notes create"},
	"notes_get":          {command: "notes get"},
	"notes_update":       {command: "notes update"},
	"notes_delete":       {command: "notes delete"},
	"notes_toggle_star":  {command: "notes star"},
	"notes_toggle_pin":   {command: "notes pin"},
	"notes_toggle_lock":  {command: "notes lock"},
	"notes_reorder_pins": {waived: "pin ordering is a drag-and-drop UI concern; a positional CLI syntax adds risk without a use case"},
	"notes_archive":      {command: "notes archive"},
	"notes_unarchive":    {command: "notes unarchive"},
	"archive_list":       {command: "archive list"},

	"note_tags_list":   {command: "notes tags"},
	"note_tags_add":    {command: "notes tag"},
	"note_tags_remove": {command: "notes untag"},

	"tags_list":   {command: "tags list"},
	"tags_create": {command: "tags create"},
	"tags_rename": {command: "tags rename"},
	"tags_delete": {command: "tags delete"},

	"export": {command: "export"},

	"images_upload": {waived: "image blobs belong to the editor workflow (paste/drag in the web UI) or MCP; the export command bundles them for retrieval"},
	"images_get":    {waived: "see images_upload"},

	"trash_list":    {command: "trash list"},
	"trash_restore": {command: "trash restore"},
	"trash_delete":  {command: "trash purge"},
	"trash_empty":   {command: "trash empty"},
}

// contractOp mirrors the fields of apispec.Operation that this test needs.
// The CLI is a separate Go module and cannot import the backend's apispec
// package, so the checked-in JSON contract is the interchange format.
type contractOp struct {
	Name       string `json:"name"`
	Scope      string `json:"scope"`
	AdminOnly  bool   `json:"admin_only"`
	CookieOnly bool   `json:"cookie_only"`
}

func loadContract(t *testing.T) []contractOp {
	t.Helper()
	data, err := os.ReadFile("../../../docs/api-contract.json")
	if err != nil {
		t.Fatalf("read api contract (generate with `make apispec` in backend/): %v", err)
	}
	var c struct {
		Version    int          `json:"version"`
		Operations []contractOp `json:"operations"`
	}
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("parse api contract: %v", err)
	}
	if c.Version != 1 {
		t.Fatalf("api contract version %d not understood by this test", c.Version)
	}
	if len(c.Operations) == 0 {
		t.Fatal("api contract has no operations")
	}
	return c.Operations
}

func TestCLICoversEveryBearerReachableOperation(t *testing.T) {
	ops := loadContract(t)
	seen := map[string]bool{}
	for _, op := range ops {
		bearerReachable := op.Scope != "public" && !op.AdminOnly && !op.CookieOnly
		entry, listed := cliCoverage[op.Name]
		if !bearerReachable {
			if listed {
				t.Errorf("op %q is not bearer-reachable; remove it from cliCoverage", op.Name)
			}
			continue
		}
		seen[op.Name] = true
		if !listed {
			t.Errorf("bearer-reachable op %q has no CLI coverage entry: add a command or an explicit waiver", op.Name)
			continue
		}
		if (entry.command == "") == (entry.waived == "") {
			t.Errorf("op %q must have exactly one of command or waiver", op.Name)
		}
	}
	for name := range cliCoverage {
		if !seen[name] {
			t.Errorf("cliCoverage entry %q does not match any operation in the contract", name)
		}
	}
}

// TestCoveredCommandsExist sanity-checks that every op mapped to a command
// names a real CLI invocation — subcommand included, so renaming or deleting
// 'notes lock' cannot leave the table silently claiming coverage while the
// top-level 'notes' command still exists.
//
// Each entry is dispatched with an undefined flag: flag parsing fails before
// any subcommand does work, so the probe reaches the real dispatcher (which
// is what knows the subcommand) without making a request. An entry naming
// several commands separates them with " / ".
func TestCoveredCommandsExist(t *testing.T) {
	var requests int
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	})

	for op, entry := range cliCoverage {
		if entry.command == "" {
			continue
		}
		for _, invocation := range strings.Split(entry.command, " / ") {
			words := strings.Fields(invocation)
			if len(words) == 0 {
				t.Errorf("op %q has an empty command entry %q", op, entry.command)
				continue
			}
			if _, ok := commands[words[0]]; !ok {
				t.Errorf("op %q maps to %q, but %q is not a CLI command", op, invocation, words[0])
				continue
			}
			args := append([]string{"--url", srv.URL, "--token", "t"}, words...)
			args = append(args, "--not-a-real-flag")
			_, stderr, _ := runCLI(t, nil, args...)
			if strings.Contains(stderr, "unknown subcommand") || strings.Contains(stderr, "unknown command") {
				t.Errorf("op %q maps to %q, which the CLI does not recognise: %s", op, invocation, stderr)
			}
		}
	}

	if requests != 0 {
		t.Errorf("probing commands should make no HTTP requests, got %d", requests)
	}
}
