package main

import (
	"fmt"
	"runtime/debug"
)

// version is injected at build time via -ldflags "-X main.version=...".
// When empty (plain 'go build' or 'go install'), versionInfo falls back to
// module build info.
var version = ""

type buildVersion struct {
	Version   string `json:"version"`
	Commit    string `json:"commit,omitempty"`
	BuildDate string `json:"build_date,omitempty"`
	GoVersion string `json:"go_version,omitempty"`
}

// versionInfo resolves the version from ldflags first, then from the
// binary's embedded build info (populated by 'go install module@version'
// and by VCS stamping on builds inside a git checkout).
func versionInfo() buildVersion {
	v := buildVersion{Version: version}
	if info, ok := debug.ReadBuildInfo(); ok {
		v.GoVersion = info.GoVersion
		if v.Version == "" {
			v.Version = info.Main.Version
		}
		var modified bool
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				v.Commit = s.Value
			case "vcs.time":
				v.BuildDate = s.Value
			case "vcs.modified":
				modified = s.Value == "true"
			}
		}
		if len(v.Commit) > 12 {
			v.Commit = v.Commit[:12]
		}
		if modified && v.Commit != "" {
			v.Commit += "-dirty"
		}
	}
	if v.Version == "" || v.Version == "(devel)" {
		v.Version = "dev"
	}
	return v
}

func cmdVersion(e *env, args []string) int {
	fs := newFlagSet(e, "version")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) > 0 {
		return e.usageError("version: takes no arguments")
	}

	v := versionInfo()
	if e.json {
		return e.emitJSON(v)
	}
	line := "crapnote " + v.Version
	if v.Commit != "" {
		line += " (" + v.Commit
		if v.BuildDate != "" {
			line += ", " + v.BuildDate
		}
		line += ")"
	}
	fmt.Fprintln(e.stdout, line)
	return exitOK
}
