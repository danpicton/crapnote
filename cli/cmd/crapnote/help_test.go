package main

import (
	"strings"
	"testing"
)

func TestHelpCommandPrintsCommandSummaryAndExitsZero(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "help")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	for _, want := range []string{"notes", "search", "tags", "trash", "export", "tokens", "version", "Exit codes", "--json", "crapnote help <command>"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("help output missing %q", want)
		}
	}
	// The summary must stay a summary: per-command detail lives in topics.
	if strings.Contains(stdout, "--body-file") {
		t.Errorf("top-level help should not include per-command flag detail:\n%s", stdout)
	}
}

func TestBareInvocationPrintsSummaryToStderrAndExits2(t *testing.T) {
	stdout, stderr, code := runCLI(t, nil)
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if stdout != "" {
		t.Errorf("stdout should be empty, got %q", stdout)
	}
	if !strings.Contains(stderr, "Commands:") {
		t.Errorf("stderr should carry the command summary, got %q", stderr)
	}
}

func TestHelpTopicPrintsCommandDetail(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "help", "notes")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	for _, want := range []string{"create --title", "--body-file", "trash restore", "crapnote notes <subcommand>"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("'help notes' output missing %q:\n%s", want, stdout)
		}
	}
}

func TestHelpUnknownTopicExits2(t *testing.T) {
	_, stderr, code := runCLI(t, nil, "help", "frobnicate")
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr, "unknown help topic") {
		t.Errorf("stderr = %q, want unknown-topic error", stderr)
	}
}

func TestEveryCommandHasAHelpTopic(t *testing.T) {
	for cmd := range commands {
		if _, ok := helpTopics[cmd]; !ok {
			t.Errorf("command %q has no help topic", cmd)
		}
	}
}

func TestCommandWithoutSubcommandShowsItsOwnHelp(t *testing.T) {
	_, stderr, code := runCLI(t, nil, "notes")
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr, "missing subcommand") || !strings.Contains(stderr, "create --title") {
		t.Errorf("stderr should carry error plus notes help, got %q", stderr)
	}
}

func TestCommandHelpSubcommandPrintsTopicAndExitsZero(t *testing.T) {
	stdout, _, code := runCLI(t, nil, "notes", "help")
	if code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
	if !strings.Contains(stdout, "create --title") {
		t.Errorf("'notes help' output missing detail:\n%s", stdout)
	}
}

func TestSearchWithoutQueryShowsSearchHelp(t *testing.T) {
	_, stderr, code := runCLI(t, nil, "search")
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr, "missing query") || !strings.Contains(stderr, "crapnote search QUERY") {
		t.Errorf("stderr should carry error plus search help, got %q", stderr)
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
