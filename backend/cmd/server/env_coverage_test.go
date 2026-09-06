package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// repoFile reads a file relative to the repository root.
func repoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

var envRefPattern = regexp.MustCompile(`(?:os\.Getenv|envOrDefault)\("([A-Z0-9_]+)"`)

// serverEnvVars enumerates every environment variable main.go reads. It is
// derived from the source rather than hardcoded so that adding a new
// os.Getenv call automatically extends the coverage checks below — the point
// of this test is that manifests and docs cannot silently drift (issue #114).
func serverEnvVars(t *testing.T) []string {
	t.Helper()
	src := repoFile(t, "backend/cmd/server/main.go")
	seen := map[string]bool{}
	var vars []string
	for _, m := range envRefPattern.FindAllStringSubmatch(src, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			vars = append(vars, m[1])
		}
	}
	if len(vars) == 0 {
		t.Fatal("no env vars found in main.go — the scan pattern is broken")
	}
	sort.Strings(vars)
	return vars
}

func TestComposePassesThroughEveryServerEnvVar(t *testing.T) {
	compose := repoFile(t, "deploy/docker-compose.yml")
	// Only the app service's environment block counts; the observability
	// stack's own vars are out of scope.
	app := compose
	if i := strings.Index(compose, "\n  prometheus:"); i > 0 {
		app = compose[:i]
	}
	for _, name := range serverEnvVars(t) {
		if !strings.Contains(app, "- "+name+"=") {
			t.Errorf("deploy/docker-compose.yml does not pass through %s", name)
		}
	}
}

func TestK8sDeploymentPassesThroughEveryServerEnvVar(t *testing.T) {
	manifest := repoFile(t, "deploy/k8s/deployment.yaml")
	for _, name := range serverEnvVars(t) {
		if strings.Contains(manifest, "- name: "+name+"\n") {
			continue
		}
		// A var may be deliberately omitted, but only with a comment saying so.
		if strings.Contains(manifest, "# not set: "+name+" ") {
			continue
		}
		t.Errorf("deploy/k8s/deployment.yaml neither sets %s nor documents why not "+
			"(add it, or a `# not set: %s <reason>` comment)", name, name)
	}
}

func TestREADMEDocumentsEveryServerEnvVar(t *testing.T) {
	readme := repoFile(t, "README.md")
	for _, name := range serverEnvVars(t) {
		if !strings.Contains(readme, "| `"+name+"` |") {
			t.Errorf("README.md env var table has no row for %s", name)
		}
	}
}

// deliberateDefaultOverrides are vars whose manifest value intentionally
// differs from the server's compiled-in default, with the reason. Everything
// else must match the default documented in the README table.
var deliberateDefaultOverrides = map[string]string{
	"DATABASE_PATH":  "manifests put the SQLite file on the mounted volume at /data",
	"METRICS_ADDR":   "metrics listen on a private port the manifests do not publish",
	"TRUST_PROXY":    "k8s traffic arrives through an ingress, so X-Forwarded-For is authoritative",
	"LOG_FORMAT":     "manifests ship JSON logs to Loki",
	"ADMIN_USERNAME": "seeded credential, supplied by the operator",
	"ADMIN_PASSWORD": "seeded credential, supplied by the operator",
}

var readmeRowPattern = regexp.MustCompile("(?m)^\\| `([A-Z0-9_]+)` \\| (—|`[^`]*`) \\|")

// readmeDefaults maps each documented env var to its documented default, with
// "—" (no default) represented as the empty string.
func readmeDefaults(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, m := range readmeRowPattern.FindAllStringSubmatch(repoFile(t, "README.md"), -1) {
		out[m[1]] = strings.Trim(m[2], "`—")
	}
	return out
}

func TestManifestDefaultsMatchServerDefaults(t *testing.T) {
	docs := readmeDefaults(t)
	compose := repoFile(t, "deploy/docker-compose.yml")
	k8s := repoFile(t, "deploy/k8s/deployment.yaml")

	composeDefault := regexp.MustCompile(`- ([A-Z0-9_]+)=\$\{[A-Z0-9_]+:?-([^}?]*)\}`)
	k8sDefault := regexp.MustCompile(`- name: ([A-Z0-9_]+)\n\s+value: "([^"]*)"`)

	for _, manifest := range []struct {
		name  string
		pairs [][]string
	}{
		{"deploy/docker-compose.yml", composeDefault.FindAllStringSubmatch(compose, -1)},
		{"deploy/k8s/deployment.yaml", k8sDefault.FindAllStringSubmatch(k8s, -1)},
	} {
		for _, m := range manifest.pairs {
			name, value := m[1], m[2]
			if _, ok := deliberateDefaultOverrides[name]; ok {
				continue
			}
			want, documented := docs[name]
			if !documented {
				continue // covered by TestREADMEDocumentsEveryServerEnvVar
			}
			if value != want {
				t.Errorf("%s sets %s=%q but the server default is %q; "+
					"change it back or record the reason in deliberateDefaultOverrides",
					manifest.name, name, value, want)
			}
		}
	}
}
