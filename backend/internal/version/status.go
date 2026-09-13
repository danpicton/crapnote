// Package version reports the running Crapnote version and whether a newer
// GitHub release is available.
package version

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Status is the version information shown in the settings screen.
type Status struct {
	Version         string `json:"version"`
	LatestVersion   string `json:"latest_version,omitempty"`
	UpdateAvailable bool   `json:"update_available"`
}

// Checker looks up the latest tagged release at an HTTP JSON endpoint.
type Checker struct {
	current  string
	tagsURL  string
	client   *http.Client
	mu       sync.Mutex
	cached   Status
	cachedAt time.Time
}

func NewChecker(current, tagsURL string, client *http.Client) *Checker {
	return &Checker{current: current, tagsURL: tagsURL, client: client}
}

func (c *Checker) Status(ctx context.Context) Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.cachedAt.IsZero() && time.Since(c.cachedAt) < 6*time.Hour {
		return c.cached
	}

	status := Status{Version: c.current}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.tagsURL, nil)
	if err != nil {
		return status
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "crapnote-version-check")
	res, err := c.client.Do(req)
	if err != nil {
		return status
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return status
	}
	var tags []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tags); err != nil {
		return status
	}
	latest := ""
	for _, tag := range tags {
		if !strings.HasPrefix(tag.Name, "v") {
			continue
		}
		if _, ok := parseVersion(tag.Name); !ok {
			continue
		}
		if latest == "" || compare(tag.Name, latest) > 0 {
			latest = tag.Name
		}
	}
	if latest == "" {
		return status
	}
	status.LatestVersion = latest
	status.UpdateAvailable = compare(latest, c.current) > 0
	c.cached = status
	c.cachedAt = time.Now()
	return status
}

func parseVersion(value string) ([3]int, bool) {
	var parts [3]int
	value = strings.TrimPrefix(value, "v")
	value = strings.SplitN(value, "-", 2)[0]
	fields := strings.Split(value, ".")
	if len(fields) != len(parts) {
		return parts, false
	}
	for i, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil {
			return parts, false
		}
		parts[i] = n
	}
	return parts, true
}

func compare(a, b string) int {
	av, aok := parseVersion(a)
	bv, bok := parseVersion(b)
	if !aok || !bok {
		return 0
	}
	for i := range av {
		if av[i] < bv[i] {
			return -1
		}
		if av[i] > bv[i] {
			return 1
		}
	}
	return 0
}
