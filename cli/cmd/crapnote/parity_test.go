package main

import (
	"encoding/json"
	"os"
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
// names a real top-level CLI command, so the table can't rot silently.
func TestCoveredCommandsExist(t *testing.T) {
	for op, entry := range cliCoverage {
		if entry.command == "" {
			continue
		}
		top := entry.command
		for i, r := range top {
			if r == ' ' {
				top = top[:i]
				break
			}
		}
		if _, ok := commands[top]; !ok {
			t.Errorf("op %q maps to command %q, but %q is not a CLI command", op, entry.command, top)
		}
	}
}
