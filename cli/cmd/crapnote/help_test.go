package main

import (
	"strings"
	"testing"
)

func TestHelpCommandPrintsFullUsageAndExitsZero(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "help")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	for _, want := range []string{"notes", "search", "tags", "trash", "export", "tokens", "Exit codes", "--json"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("help output missing %q", want)
		}
	}
}

func TestSubcommandHelpFlagPrintsUsageAndExitsZero(t *testing.T) {
	_, stderr, code := runCLI(t, nil, "notes", "list", "--help")
	if code != 0 {
		t.Fatalf("exit = %d, want 0 for --help", code)
	}
	if !strings.Contains(stderr, "Usage: crapnote notes list") {
		t.Errorf("help output = %q, want usage line", stderr)
	}
	if !strings.Contains(stderr, "-starred") {
		t.Errorf("help output = %q, want flag documentation", stderr)
	}
}
