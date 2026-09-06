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

// manifestVar identifies one env var in one deploy manifest, so an exemption
// granted where it is justified (TRUST_PROXY behind a k8s ingress) does not
// silently exempt the same var where it is not (compose, where the app is
// usually exposed directly and false is the security-relevant default).
type manifestVar struct{ manifest, name string }

// deliberateDefaultOverrides are the (manifest, var) pairs whose value
// intentionally differs from the server's compiled-in default, with the
// reason. Everything else must match serverEnvDefaults exactly.
var deliberateDefaultOverrides = map[manifestVar]string{
	{compose, "DATABASE_PATH"}:   "the SQLite file lives on the named volume at /data",
	{k8sDeploy, "DATABASE_PATH"}: "the SQLite file lives on the mounted PVC at /data",
	{compose, "METRICS_ADDR"}:    "metrics are served on a port reachable only inside the compose network",
	{k8sDeploy, "METRICS_ADDR"}:  "metrics are served on a port deliberately absent from the Service",
	{k8sDeploy, "TRUST_PROXY"}:   "cluster traffic arrives through the ingress, so X-Forwarded-For is authoritative",
	{compose, "ADMIN_USERNAME"}:  "compose seeds a conventional admin username; the password has no default",
	{compose, "LOG_FORMAT"}:      "JSON logs are what Alloy ships to Loki",
	{k8sDeploy, "LOG_FORMAT"}:    "JSON logs are what cluster log collection ingests",
}

const (
	compose   = "deploy/docker-compose.yml"
	k8sDeploy = "deploy/k8s/deployment.yaml"
)

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

// serverEnvDefaults is the authoritative list of compiled-in defaults, derived
// in main.go from the same constants the server actually applies. Every var
// main.go reads must appear in it, so a new knob cannot skip these checks.
func TestServerEnvDefaultsCoversEveryEnvVar(t *testing.T) {
	for _, name := range serverEnvVars(t) {
		if _, ok := serverEnvDefaults[name]; !ok {
			t.Errorf("serverEnvDefaults in main.go has no entry for %s", name)
		}
	}
}

func TestREADMEDefaultsMatchCompiledDefaults(t *testing.T) {
	docs := readmeDefaults(t)
	for name, want := range serverEnvDefaults {
		got, documented := docs[name]
		if !documented {
			continue // covered by TestREADMEDocumentsEveryServerEnvVar
		}
		if got != want {
			t.Errorf("README documents %s default as %q but the server compiles in %q",
				name, got, want)
		}
	}
}

func TestManifestDefaultsMatchCompiledDefaults(t *testing.T) {
	composeDefault := regexp.MustCompile(`- ([A-Z0-9_]+)=\$\{[A-Z0-9_]+:?-([^}?]*)\}`)
	k8sDefault := regexp.MustCompile(`- name: ([A-Z0-9_]+)\n\s+value: "([^"]*)"`)

	for _, m := range []struct {
		name  string
		pairs [][]string
	}{
		{compose, composeDefault.FindAllStringSubmatch(repoFile(t, compose), -1)},
		{k8sDeploy, k8sDefault.FindAllStringSubmatch(repoFile(t, k8sDeploy), -1)},
	} {
		for _, pair := range m.pairs {
			name, value := pair[1], pair[2]
			if _, ok := deliberateDefaultOverrides[manifestVar{m.name, name}]; ok {
				continue
			}
			want, known := serverEnvDefaults[name]
			if !known {
				continue // not a server var (or caught by the coverage test above)
			}
			if value != want {
				t.Errorf("%s sets %s=%q but the server compiles in %q; "+
					"change it back or record the reason in deliberateDefaultOverrides",
					m.name, name, value, want)
			}
		}
	}
}
