package importer

import (
	"bytes"
	"encoding/binary"
	"testing"

	yzip "github.com/yeka/zip"
)

func TestDirectoryPreflightRejectsAlternativeLibraryDirectories(t *testing.T) {
	for _, variant := range []string{"shadow end record", "ZIP64 locator in entry comment"} {
		t.Run(variant, func(t *testing.T) {
			var archive bytes.Buffer
			writer := yzip.NewWriter(&archive)
			header := &yzip.FileHeader{Name: "note.md", Method: yzip.Deflate}
			if variant == "ZIP64 locator in entry comment" {
				locator := make([]byte, 20)
				binary.LittleEndian.PutUint32(locator, 0x07064b50)
				header.Comment = string(locator)
			}
			entry, err := writer.CreateHeader(header)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := entry.Write([]byte("# Note\n\nbody\n")); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			data := archive.Bytes()
			if variant == "shadow end record" {
				end := len(data) - 22
				shadow := append([]byte(nil), data[end:]...)
				// yeka accepts an end record followed by trailing bytes, even
				// when a different (earlier) end record ends exactly at EOF.
				binary.LittleEndian.PutUint16(data[end+20:], 23)
				data = append(data, shadow...)
				data = append(data, 'x')
			}
			if err := checkDirectory(bytes.NewReader(data), int64(len(data)), MaxEntries); err == nil {
				t.Fatal("preflight accepted a directory different from the one yeka/zip will allocate")
			}
		})
	}
}
