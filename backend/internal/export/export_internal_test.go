// Package export (internal test) covers unexported helper functions.
package export

import (
	"strings"
	"testing"
)

func TestSanitiseFilename(t *testing.T) {
	tests := []struct {
		title string
		want  string
	}{
		{"Hello World", "hello-world.md"},
		// unsafe chars replaced, then collapsed — trailing/leading hyphens trimmed
		{"Hello/World & More!", "hello-world-more.md"},
		{"", "note.md"},
		{"---", "note.md"},
		{"My Note", "my-note.md"},
		{"2024-01-15 Meeting Notes", "2024-01-15-meeting-notes.md"},
		// all unsafe FS chars removed and collapsed
		{`File:Name*With?Bad<Chars>|`, "file-name-with-bad-chars.md"},
		// unicode letters pass IsLetter so é is preserved
		{"Café Notes", "café-notes.md"},
	}
	for _, tc := range tests {
		got := sanitiseFilename(tc.title)
		if got != tc.want {
			t.Errorf("sanitiseFilename(%q) = %q, want %q", tc.title, got, tc.want)
		}
	}
}

func TestSanitiseFilename_Truncation(t *testing.T) {
	title := strings.Repeat("a", 200)
	got := sanitiseFilename(title)
	base := strings.TrimSuffix(got, ".md")
	if len(base) > 80 {
		t.Errorf("expected base ≤ 80 chars, got %d", len(base))
	}
	if !strings.HasSuffix(got, ".md") {
		t.Errorf("expected .md suffix, got %q", got)
	}
}

func TestMimeToExt(t *testing.T) {
	tests := []struct {
		mime string
		want string
	}{
		{"image/png", "png"},
		{"image/jpeg", "jpg"},
		{"image/jpg", "jpg"},
		{"image/gif", "gif"},
		{"image/webp", "webp"},
		{"image/svg+xml", "svg"},
		{"image/avif", "avif"},
		{"IMAGE/PNG", "png"},     // case insensitive
		{"  image/png  ", "png"}, // whitespace trimmed
		{"image/tiff", "tiff"},   // unknown → subtype
		{"image/bmp", "bmp"},     // unknown → subtype
		{"noslash", "bin"},       // no slash → "bin"
	}
	for _, tc := range tests {
		got := mimeToExt(tc.mime)
		if got != tc.want {
			t.Errorf("mimeToExt(%q) = %q, want %q", tc.mime, got, tc.want)
		}
	}
}

func TestExtractImageIDs(t *testing.T) {
	// The regex matches [a-f0-9\-]+ so IDs must be lowercase hex + hyphens.
	id1 := "abc12345-def0-4abc-89ab-cdef01234567"
	id2 := "fedcba98-7654-3210-fedc-ba9876543210"

	tests := []struct {
		name string
		body string
		want []string
	}{
		{
			name: "no images",
			body: "Just some text with no images",
			want: nil,
		},
		{
			name: "single image",
			body: `/api/images/` + id1,
			want: []string{id1},
		},
		{
			name: "multiple images",
			body: `/api/images/` + id1 + ` text /api/images/` + id2,
			want: []string{id1, id2},
		},
		{
			name: "deduplication",
			body: `/api/images/` + id1 + ` text /api/images/` + id1,
			want: []string{id1},
		},
		{
			name: "mixed order preserved",
			body: `/api/images/` + id1 + ` other /api/images/` + id2 + ` /api/images/` + id1,
			want: []string{id1, id2},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractImageIDs(tc.body)
			if len(got) != len(tc.want) {
				t.Fatalf("extractImageIDs(%q): got %v, want %v", tc.body, got, tc.want)
			}
			for i, id := range got {
				if id != tc.want[i] {
					t.Errorf("[%d]: got %q, want %q", i, id, tc.want[i])
				}
			}
		})
	}
}

func TestRewriteImageSrcs(t *testing.T) {
	id1 := "abc12345-def0-4abc-89ab-cdef01234567"
	id2 := "fedcba98-7654-3210-fedc-ba9876543210"
	imgFiles := map[string]string{
		id1: id1 + ".png",
		id2: id2 + ".jpg",
	}

	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "no images",
			body: "plain text",
			want: "plain text",
		},
		{
			name: "known image replaced",
			body: `/api/images/` + id1,
			want: `images/` + id1 + `.png`,
		},
		{
			name: "unknown image left alone",
			body: `/api/images/000000-0000-0000-0000-000000000000`,
			want: `/api/images/000000-0000-0000-0000-000000000000`,
		},
		{
			name: "both known images replaced",
			body: `/api/images/` + id1 + ` and /api/images/` + id2,
			want: `images/` + id1 + `.png and images/` + id2 + `.jpg`,
		},
		{
			name: "known and unknown mixed",
			body: `/api/images/` + id1 + ` /api/images/000000-0000-0000-0000-000000000000`,
			want: `images/` + id1 + `.png /api/images/000000-0000-0000-0000-000000000000`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := rewriteImageSrcs(tc.body, imgFiles)
			if got != tc.want {
				t.Errorf("rewriteImageSrcs: got %q, want %q", got, tc.want)
			}
		})
	}
}
