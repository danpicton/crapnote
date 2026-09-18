package importer_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	yzip "github.com/yeka/zip"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestServiceImport_RestoresNotesAndSharedImageReferences(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	user, err := auth.NewUserRepo(database).Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	const oldID = "12345678-1234-4234-8234-123456789abc"
	body := "![markdown](/api/images/" + oldID + ")\n<img src=\"/api/images/" + oldID + "\">" +
		"\n![escaped \\] label](/api/images/" + oldID + ")" +
		"\n<img alt=\"a > b\" src=\"/api/images/" + oldID + "\">" +
		"\n![reference][escaped\\]]\n[escaped\\]]: /api/images/" + oldID +
		"\n`/api/images/" + oldID + "`" +
		"\n![external](https://example.org/images/external.png)" +
		"\n<img src=\"/images/static.png\">"
	var exported bytes.Buffer
	if err := export.Build(&exported, []*notes.Note{
		{Title: "Same title", Body: body},
		{Title: "Same title", Body: "![shared][asset]\n\n[asset]: /api/images/" + oldID + ` "Shared image"`},
	}, map[string]images.Data{oldID: {MimeType: "image/png", Bytes: testPNG()}}, ""); err != nil {
		t.Fatalf("build export: %v", err)
	}

	result, err := importer.NewService(database, importer.DefaultConfig()).Import(
		context.Background(), user.ID, exported.Bytes(), "",
	)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.ImportedNotes != 2 {
		t.Fatalf("imported notes = %d, want 2", result.ImportedNotes)
	}

	got, err := notes.NewRepo(database).List(context.Background(), user.ID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	if len(got) != 2 || got[0].Title != "Same title" || got[1].Title != "Same title" {
		t.Fatalf("imported notes = %#v", got)
	}
	for _, note := range got {
		if note.Archived || note.Pinned || note.Locked || note.Starred {
			t.Errorf("imported note has restored metadata: %#v", note)
		}
	}

	idPattern := regexp.MustCompile(`/api/images/([a-f0-9-]+)`)
	var newID string
	for _, note := range got {
		matches := idPattern.FindAllStringSubmatch(note.Body, -1)
		if len(matches) == 0 {
			t.Fatalf("note body has no restored image URL: %q", note.Body)
		}
		for _, match := range matches {
			if newID == "" {
				newID = match[1]
			}
			if match[1] != newID {
				t.Fatalf("shared image references use different IDs: %q and %q", newID, match[1])
			}
		}
		if strings.Contains(note.Body, "images/"+oldID) {
			t.Fatalf("relative export reference remains in body: %q", note.Body)
		}
	}

	var owner int64
	var stored []byte
	if err := database.QueryRow(`SELECT user_id, data FROM images WHERE id = ?`, newID).Scan(&owner, &stored); err != nil {
		t.Fatalf("read imported image: %v", err)
	}
	if owner != user.ID || !bytes.Equal(stored, testPNG()) {
		t.Fatalf("stored image owner/data = %d/%d bytes", owner, len(stored))
	}
}

func TestServiceImport_PreservesOrdinaryRelativeImagePaths(t *testing.T) {
	const oldID = "12345678-1234-4234-8234-123456789abc"
	const relativeBody = "![logo](images/logo.png)\n" +
		"![hex name](images/deadbeef.png)\n" +
		"![UUID name](images/fedcba98-7654-4321-8234-abcdef012345.png)\n" +
		"![UUID reference][uuid]\n[uuid]: images/fedcba98-7654-4321-8234-abcdef012345.png\n" +
		"<img src=\"images/fedcba98-7654-4321-8234-abcdef012345.png\">\n" +
		"![reference][logo]\n[logo]: images/logo.png\n" +
		"<img alt=\"a > b\" src=\"images/logo.png\">\n" +
		"`images/logo.png`"
	for _, password := range []string{"", "secret"} {
		for _, withBundle := range []bool{false, true} {
			name := "plain"
			if password != "" {
				name = "encrypted"
			}
			if withBundle {
				name += "/with-bundle"
			}
			t.Run(name, func(t *testing.T) {
				_, user, database := importHandlerFixture(t)
				body := relativeBody
				var bundled map[string]images.Data
				if withBundle {
					body += "\n![owned](/api/images/" + oldID + ")"
					bundled = map[string]images.Data{oldID: {MimeType: "image/png", Bytes: testPNG()}}
				}
				var exported bytes.Buffer
				if err := export.Build(&exported, []*notes.Note{{Title: "Relative images", Body: body}}, bundled, password); err != nil {
					t.Fatal(err)
				}
				result, err := importer.NewService(database, importer.DefaultConfig()).Import(t.Context(), user.ID, exported.Bytes(), password)
				if err != nil {
					t.Fatalf("import valid export: %v", err)
				}
				if result.ImportedNotes != 1 {
					t.Fatalf("imported %d notes", result.ImportedNotes)
				}
				wantBody := body
				if withBundle {
					var newID string
					if err := database.QueryRow(`SELECT id FROM images WHERE user_id = ?`, user.ID).Scan(&newID); err != nil {
						t.Fatal(err)
					}
					if newID == oldID {
						t.Fatal("bundled image did not get a fresh ID")
					}
					wantBody = strings.ReplaceAll(body, "/api/images/"+oldID, "/api/images/"+newID)
				}
				got, err := notes.NewRepo(database).List(t.Context(), user.ID, notes.ListFilter{})
				if err != nil {
					t.Fatal(err)
				}
				if len(got) != 1 || got[0].Body != wantBody {
					t.Fatalf("import changed relative links: got %#v, want body %q", got, wantBody)
				}
				var imageCount int
				if err := database.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&imageCount); err != nil {
					t.Fatal(err)
				}
				wantImages := 0
				if withBundle {
					wantImages = 1
				}
				if imageCount != wantImages {
					t.Fatalf("stored %d images, want %d", imageCount, wantImages)
				}
			})
		}
	}
}

func TestServiceImport_CreatesNewAccountScopedNotesEveryTime(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	users := auth.NewUserRepo(database)
	alice, err := users.Create(t.Context(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := users.Create(t.Context(), "bob", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	notesService := notes.NewService(notes.NewRepo(database))
	existing, err := notesService.Create(t.Context(), alice.ID, "Duplicate", "existing")
	if err != nil {
		t.Fatalf("create existing note: %v", err)
	}

	var exported bytes.Buffer
	if err := export.Build(&exported, []*notes.Note{{Title: "Duplicate", Body: "imported"}}, nil, ""); err != nil {
		t.Fatalf("build export: %v", err)
	}
	service := importer.NewService(database, importer.DefaultConfig())
	for range 2 {
		if _, err := service.Import(t.Context(), alice.ID, exported.Bytes(), ""); err != nil {
			t.Fatalf("import for alice: %v", err)
		}
	}
	if _, err := service.Import(t.Context(), bob.ID, exported.Bytes(), ""); err != nil {
		t.Fatalf("import for bob: %v", err)
	}

	aliceNotes, err := notes.NewRepo(database).List(t.Context(), alice.ID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list alice notes: %v", err)
	}
	if len(aliceNotes) != 3 {
		t.Fatalf("alice has %d notes, want existing plus two imports", len(aliceNotes))
	}
	ids := map[int64]bool{existing.ID: true}
	for _, note := range aliceNotes {
		if note.UserID != alice.ID || note.Title != "Duplicate" {
			t.Errorf("unexpected alice note: %#v", note)
		}
		ids[note.ID] = true
	}
	if len(ids) != 3 {
		t.Fatalf("imports did not get fresh IDs: %v", ids)
	}
	bobNotes, err := notes.NewRepo(database).List(t.Context(), bob.ID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list bob notes: %v", err)
	}
	if len(bobNotes) != 1 || bobNotes[0].UserID != bob.ID || bobNotes[0].Body != "imported" {
		t.Fatalf("bob notes = %#v", bobNotes)
	}
}

func TestServiceImport_EncryptedArchiveRequiresCorrectPasswordWithoutPartialWrites(t *testing.T) {
	var exported bytes.Buffer
	if err := export.Build(&exported, []*notes.Note{{Title: "Secret", Body: "body"}}, nil, "correct"); err != nil {
		t.Fatalf("build export: %v", err)
	}

	tests := []struct {
		name     string
		password string
		wantErr  error
		want     int
	}{
		{name: "missing password", wantErr: importer.ErrPasswordRequired},
		{name: "wrong password", password: "wrong", wantErr: importer.ErrDecrypt},
		{name: "correct password", password: "correct", want: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database, err := db.Open(db.Config{SQLitePath: ":memory:"})
			if err != nil {
				t.Fatalf("open db: %v", err)
			}
			defer database.Close()
			user, err := auth.NewUserRepo(database).Create(t.Context(), "alice", "$2a$12$x", false)
			if err != nil {
				t.Fatalf("create user: %v", err)
			}

			result, err := importer.NewService(database, importer.DefaultConfig()).Import(
				t.Context(), user.ID, exported.Bytes(), tc.password,
			)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			if result.ImportedNotes != tc.want {
				t.Errorf("imported notes = %d, want %d", result.ImportedNotes, tc.want)
			}
			var count int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&count); err != nil {
				t.Fatalf("count notes: %v", err)
			}
			if count != tc.want {
				t.Errorf("stored notes = %d, want %d", count, tc.want)
			}
		})
	}
}

func TestServiceImport_QuotaFailuresStoreNothing(t *testing.T) {
	tests := []struct {
		name    string
		entries map[string][]byte
		quota   int64
		wantErr error
	}{
		{
			name: "image quota",
			entries: map[string][]byte{
				"note.md":          []byte("# Note\n\n![image](images/image.png)\n"),
				"images/image.png": testPNG(),
			},
			quota:   1,
			wantErr: importer.ErrQuota,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database, err := db.Open(db.Config{SQLitePath: ":memory:"})
			if err != nil {
				t.Fatalf("open db: %v", err)
			}
			defer database.Close()
			user, err := auth.NewUserRepo(database).Create(t.Context(), "alice", "$2a$12$x", false)
			if err != nil {
				t.Fatalf("create user: %v", err)
			}
			config := importer.DefaultConfig()
			config.ImageQuotaBytes = tc.quota
			_, err = importer.NewService(database, config).Import(t.Context(), user.ID, makeZIP(t, tc.entries), "")
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			var notesCount, imagesCount int
			_ = database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&notesCount)
			_ = database.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&imagesCount)
			if notesCount != 0 || imagesCount != 0 {
				t.Fatalf("failure stored %d notes and %d images", notesCount, imagesCount)
			}
		})
	}
}

func TestServiceImport_UnlistedImagePathsAreNotProofOfMissingBundles(t *testing.T) {
	const keptID = "12345678-1234-4234-8234-123456789abc"
	const missingID = "abcdef01-1234-4234-8234-123456789abc"
	for _, password := range []string{"", "secret"} {
		name := "plain"
		if password != "" {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			_, user, database := importHandlerFixture(t)
			var exported bytes.Buffer
			if err := export.Build(&exported, []*notes.Note{
				{Title: "A", Body: "![owned](/api/images/" + keptID + ")"},
				{Title: "Z", Body: "![logo](images/logo.png)\n![missing][asset]\n[asset]: /api/images/" + missingID},
			}, map[string]images.Data{
				keptID:    {MimeType: "image/png", Bytes: testPNG()},
				missingID: {MimeType: "image/png", Bytes: testPNG()},
			}, password); err != nil {
				t.Fatal(err)
			}

			// Damage a real export by omitting one bundled image, leaving the
			// exporter's rewritten note references and other entries intact.
			zr, err := yzip.NewReader(bytes.NewReader(exported.Bytes()), int64(exported.Len()))
			if err != nil {
				t.Fatal(err)
			}
			var damaged bytes.Buffer
			zw := yzip.NewWriter(&damaged)
			for _, file := range zr.File {
				if file.Name == "images/"+missingID+".png" {
					continue
				}
				if file.IsEncrypted() {
					file.SetPassword(password)
				}
				source, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				var target io.Writer
				if password == "" {
					target, err = zw.Create(file.Name)
				} else {
					target, err = zw.Encrypt(file.Name, password, yzip.AES256Encryption)
				}
				if err != nil {
					source.Close()
					t.Fatal(err)
				}
				_, err = io.Copy(target, source)
				closeErr := source.Close()
				if err != nil || closeErr != nil {
					t.Fatalf("copy entry: %v, close: %v", err, closeErr)
				}
			}
			if err := zw.Close(); err != nil {
				t.Fatal(err)
			}
			// An ordinary relative link produces exactly the same entry names
			// and contents. The legacy format has no manifest to distinguish it.
			body := "![logo](images/logo.png)\n![missing][asset]\n[asset]: images/" + missingID + ".png"
			var ordinary bytes.Buffer
			if err := export.Build(&ordinary, []*notes.Note{
				{Title: "A", Body: "![owned](/api/images/" + keptID + ")"},
				{Title: "Z", Body: body},
			}, map[string]images.Data{keptID: {MimeType: "image/png", Bytes: testPNG()}}, password); err != nil {
				t.Fatal(err)
			}
			first, err := importer.Parse(damaged.Bytes(), password, importer.DefaultLimits())
			if err != nil {
				t.Fatal(err)
			}
			second, err := importer.Parse(ordinary.Bytes(), password, importer.DefaultLimits())
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(first, second) {
				t.Fatal("fixture contents should be indistinguishable")
			}
			result, err := importer.NewService(database, importer.DefaultConfig()).Import(t.Context(), user.ID, damaged.Bytes(), password)
			if err != nil || result.ImportedNotes != 2 {
				t.Fatalf("import = %+v, %v", result, err)
			}
			var got string
			if err := database.QueryRow(`SELECT body FROM notes WHERE title = 'Z'`).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if got != body {
				t.Fatalf("unlisted path changed: %q", got)
			}
		})
	}
}

func TestServiceImport_RollsBackImagesWhenNoteInsertFails(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	user, err := auth.NewUserRepo(database).Create(t.Context(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	// Leave the notes triggers in place but remove their target so the note
	// insert fails after the imported image has been inserted in the transaction.
	if _, err := database.Exec(`DROP TABLE notes_fts`); err != nil {
		t.Fatalf("drop FTS table: %v", err)
	}
	archive := makeZIP(t, map[string][]byte{
		"note.md":          []byte("# Note\n\n![image](images/image.png)\n"),
		"images/image.png": testPNG(),
	})

	if _, err := importer.NewService(database, importer.DefaultConfig()).Import(t.Context(), user.ID, archive, ""); err == nil {
		t.Fatal("expected note insertion failure")
	}
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&count); err != nil {
		t.Fatalf("count images: %v", err)
	}
	if count != 0 {
		t.Fatalf("transaction left %d imported images behind", count)
	}
}

func TestServiceImport_LateArchiveFailuresRollBackNotesAndImages(t *testing.T) {
	const oldID = "12345678-1234-4234-8234-123456789abc"
	for _, failure := range []string{"AES authentication", "false decompressed size", "ambiguous title", "invalid image"} {
		t.Run(failure, func(t *testing.T) {
			_, user, database := importHandlerFixture(t)
			last := &notes.Note{Title: "Z", Body: "last"}
			if failure == "ambiguous title" {
				last.Title = "Z\n"
			}
			imageBytes := testPNG()
			if failure == "invalid image" {
				imageBytes = []byte("not an image")
			}
			var exported bytes.Buffer
			if err := export.Build(&exported, []*notes.Note{
				{Title: "A", Body: "![image](/api/images/" + oldID + ")"}, last,
			}, map[string]images.Data{oldID: {MimeType: "image/png", Bytes: imageBytes}}, "secret"); err != nil {
				t.Fatal(err)
			}
			data := exported.Bytes()
			if failure == "AES authentication" {
				zr, err := yzip.NewReader(bytes.NewReader(data), int64(len(data)))
				if err != nil {
					t.Fatal(err)
				}
				file := zr.File[len(zr.File)-1]
				offset, err := file.DataOffset()
				if err != nil {
					t.Fatal(err)
				}
				data[offset+int64(file.CompressedSize64)-1] ^= 1 // corrupt final authentication tag
			}
			if failure == "false decompressed size" {
				central := bytes.LastIndex(data, []byte{'P', 'K', 1, 2})
				binary.LittleEndian.PutUint32(data[central+24:], 1)
			}
			_, err := importer.NewService(database, importer.DefaultConfig()).Import(t.Context(), user.ID, data, "secret")
			if !errors.Is(err, importer.ErrInvalidArchive) {
				t.Fatalf("error = %v", err)
			}
			for _, table := range []string{"notes", "images"} {
				var count int
				if err := database.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
					t.Fatal(err)
				}
				if count != 0 {
					t.Fatalf("failure left %d rows in %s", count, table)
				}
			}
		})
	}
}

func makeZIP(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := yzip.NewWriter(&buffer)
	paths := make([]string, 0, len(entries))
	for name := range entries {
		paths = append(paths, name)
	}
	sort.Strings(paths)
	for _, name := range paths {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create ZIP entry: %v", err)
		}
		if _, err := io.Copy(entry, bytes.NewReader(entries[name])); err != nil {
			t.Fatalf("write ZIP entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close ZIP: %v", err)
	}
	return buffer.Bytes()
}

func testPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
		0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
		0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
