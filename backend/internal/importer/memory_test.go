package importer_test

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/notes"
)

// Exercise a highly compressible 100 MB export against on-disk SQLite, not an
// in-memory DB whose intentional storage would obscure importer memory use.
// Run: go test -tags sqlite_fts5 ./internal/importer -run '^$' -bench BenchmarkImportReaderMemory -benchtime=1x
func BenchmarkImportReaderMemory(b *testing.B) {
	for _, password := range []string{"", "secret"} {
		name := "plain"
		if password != "" {
			name = "AES256"
		}
		b.Run(name, func(b *testing.B) {
			directory := b.TempDir()
			file, err := os.CreateTemp(directory, "export-*.zip")
			if err != nil {
				b.Fatal(err)
			}
			defer file.Close()
			body := strings.Repeat("x", 400_000)
			list := make([]*notes.Note, 250)
			for i := range list {
				list[i] = &notes.Note{Title: fmt.Sprintf("Note %d", i), Body: body}
			}
			if err := export.Build(file, list, nil, password); err != nil {
				b.Fatal(err)
			}
			info, err := file.Stat()
			if err != nil {
				b.Fatal(err)
			}
			database, err := db.Open(db.Config{SQLitePath: filepath.Join(directory, "import.db")})
			if err != nil {
				b.Fatal(err)
			}
			defer database.Close()
			user, err := auth.NewUserRepo(database).Create(b.Context(), "alice", "$2a$12$x", false)
			if err != nil {
				b.Fatal(err)
			}
			service := importer.NewService(database, importer.DefaultConfig())
			measured := &heapObservedReader{ReaderAt: file}
			runtime.GC()
			runtime.GC() // release the exporter's pooled compression writer
			b.SetBytes(100_000_000)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				result, err := service.ImportReader(b.Context(), user.ID, measured, info.Size(), password)
				if err != nil || result.ImportedNotes != 250 {
					b.Fatalf("result = %+v, error = %v", result, err)
				}
			}
			b.StopTimer()
			b.ReportMetric(float64(measured.peak)/(1<<20), "peak-Go-heap-MiB")
		})
	}
}

type heapObservedReader struct {
	io.ReaderAt
	peak uint64
}

func (r *heapObservedReader) ReadAt(p []byte, offset int64) (int, error) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	if stats.HeapAlloc > r.peak {
		r.peak = stats.HeapAlloc
	}
	return r.ReaderAt.ReadAt(p, offset)
}
