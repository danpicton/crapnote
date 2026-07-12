package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestVersionCommandPrintsVersionLine(t *testing.T) {
	stdout, stderr, code := runCLI(t, nil, "version")
	if code != 0 {
		t.Fatalf("exit = %d, want 0 (stderr: %s)", code, stderr)
	}
	if !strings.HasPrefix(stdout, "crapnote ") {
		t.Errorf("stdout = %q, want 'crapnote <version>' line", stdout)
	}
}

func TestVersionFlagAliasWorks(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "--version")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	if !strings.HasPrefix(stdout, "crapnote ") {
		t.Errorf("stdout = %q, want version line", stdout)
	}
}

func TestVersionJSONEmitsStructuredOutput(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "version", "--json")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(stdout), &v); err != nil {
		t.Fatalf("stdout is not pure JSON: %v\n%s", err, stdout)
	}
	if v["version"] == "" {
		t.Errorf("version field empty: %s", stdout)
	}
}

func TestVersionRejectsPositionalArgs(t *testing.T) {
	_, _, code := runCLI(t, nil, "version", "extra")
	if code != 2 {
		t.Errorf("exit = %d, want 2 for stray argument", code)
	}
}

func TestLdflagsVersionTakesPrecedence(t *testing.T) {
	old := version
	version = "v9.9.9-test"
	t.Cleanup(func() { version = old })

	if got := versionInfo().Version; got != "v9.9.9-test" {
		t.Errorf("Version = %q, want ldflags value", got)
	}
}
