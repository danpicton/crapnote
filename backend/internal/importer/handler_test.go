package importer_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestHandler_ImportsPlainAndEncryptedExports(t *testing.T) {
	tests := []struct {
		name     string
		password string
	}{
		{name: "plain"},
		{name: "AES-256 encrypted", password: "secret"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler, user, database := importHandlerFixture(t)
			var archive bytes.Buffer
			if err := export.Build(&archive, []*notes.Note{{Title: "Imported", Body: "body"}}, nil, tc.password); err != nil {
				t.Fatalf("build export: %v", err)
			}
			req := importRequest(t, archive.Bytes(), tc.password)
			req = req.WithContext(auth.WithUser(req.Context(), user))
			response := newImportRecorder()

			handler.Import(response, req)

			if response.Code != http.StatusCreated {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
			if len(response.deadlines) != 2 || time.Until(response.deadlines[0]) <= 0 || time.Until(response.deadlines[0]) > importer.MaxUploadDuration || !response.deadlines[1].IsZero() {
				t.Fatalf("upload deadline was not set once then cleared: %v", response.deadlines)
			}
			var result importer.Result
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatalf("decode result: %v", err)
			}
			if result.ImportedNotes != 1 {
				t.Fatalf("imported notes = %d", result.ImportedNotes)
			}
			var count int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE user_id = ?`, user.ID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("stored notes = %d, error %v", count, err)
			}
		})
	}
}

func TestHandler_PasswordAndEmptyArchiveErrorsAreActionableAndAtomic(t *testing.T) {
	var encrypted bytes.Buffer
	if err := export.Build(&encrypted, []*notes.Note{{Title: "Secret", Body: "body"}}, nil, "correct"); err != nil {
		t.Fatalf("build encrypted export: %v", err)
	}
	tests := []struct {
		name     string
		archive  []byte
		password string
		message  string
	}{
		{name: "missing password", archive: encrypted.Bytes(), message: "password-protected"},
		{name: "wrong password", archive: encrypted.Bytes(), password: "wrong", message: "check the password"},
		{name: "no notes", archive: makeZIP(t, map[string][]byte{"images/image.png": testPNG()}), message: "no note entries"},
		{name: "corrupt", archive: []byte("not a ZIP"), message: "invalid or corrupt ZIP"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler, user, database := importHandlerFixture(t)
			req := importRequest(t, tc.archive, tc.password)
			req = req.WithContext(auth.WithUser(req.Context(), user))
			response := newImportRecorder()

			handler.Import(response, req)

			if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte(tc.message)) {
				t.Fatalf("status/body = %d %q, want actionable %q", response.Code, response.Body.String(), tc.message)
			}
			var noteCount, imageCount int
			_ = database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&noteCount)
			_ = database.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&imageCount)
			if noteCount != 0 || imageCount != 0 {
				t.Fatalf("failed import stored %d notes and %d images", noteCount, imageCount)
			}
		})
	}
}

func TestHandler_RejectsTruncatedAESExtraFieldsWithoutPanic(t *testing.T) {
	for length := 0; length < 7; length++ {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			handler, user, database := importHandlerFixture(t)
			var exported bytes.Buffer
			if err := export.Build(&exported, []*notes.Note{{Title: "Note", Body: "body"}}, nil, "secret"); err != nil {
				t.Fatal(err)
			}
			data := exported.Bytes()
			central := bytes.LastIndex(data, []byte{'P', 'K', 1, 2})
			extra := central + 46 + int(binary.LittleEndian.Uint16(data[central+28:]))
			if binary.LittleEndian.Uint16(data[extra:]) != 0x9901 {
				t.Fatal("fixture has no AES extra field")
			}
			binary.LittleEndian.PutUint16(data[extra+2:], uint16(length))
			req := importRequest(t, data, "secret")
			req = req.WithContext(auth.WithUser(req.Context(), user))
			response := newImportRecorder()
			defer func() {
				if value := recover(); value != nil {
					t.Errorf("malformed AES metadata panicked: %v", value)
				}
			}()
			handler.Import(response, req)
			if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("AES extra field")) {
				t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
			}
			var count int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("notes = %d, error = %v", count, err)
			}
		})
	}
}

// Exercise real socket reads through the production observability wrappers.
// Only shorten the requested deadline at the network boundary to keep the test fast.
func TestHandler_StalledUploadsTimeOutAndReleaseAdmission(t *testing.T) {
	for _, prefix := range []string{
		"",
		"--test\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"backup.zip\"\r\n\r\npartial",
		"--test\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\npartial",
		// The multipart terminator is not necessarily the end of the HTTP body.
		"--test\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"backup.zip\"\r\n\r\npartial\r\n--test--\r\n",
	} {
		t.Run(fmt.Sprint(len(prefix)), func(t *testing.T) {
			directory := t.TempDir()
			t.Setenv("TMPDIR", directory)
			handler, user, database := importHandlerFixture(t)
			logged := middleware.Metrics()(middleware.Logging(slog.New(slog.NewTextHandler(io.Discard, nil)))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handler.Import(w, r.WithContext(auth.WithUser(r.Context(), user)))
			})))
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				logged.ServeHTTP(shortDeadlineWriter{w}, r)
			}))
			defer server.Close()
			connection, err := net.Dial("tcp", server.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			if err := connection.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			_, err = fmt.Fprintf(connection, "POST /api/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=test\r\nContent-Length: 1024\r\n\r\n%s", prefix)
			if err != nil {
				t.Fatal(err)
			}
			if prefix != "" {
				// Continuous trickle traffic must not extend the absolute deadline.
				stop, stopped := make(chan struct{}), make(chan struct{})
				go func() {
					defer close(stopped)
					ticker := time.NewTicker(20 * time.Millisecond)
					defer ticker.Stop()
					for {
						select {
						case <-stop:
							return
						case <-ticker.C:
							if _, err := connection.Write([]byte("x")); err != nil {
								return
							}
						}
					}
				}()
				defer func() { close(stop); <-stopped }()
			}
			response, err := http.ReadResponse(bufio.NewReader(connection), nil)
			if err != nil {
				t.Fatalf("stalled upload did not get a timely response: %v", err)
			}
			message, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || response.StatusCode != http.StatusRequestTimeout || !bytes.Contains(message, []byte("upload timed out")) {
				t.Fatalf("response = %d %s, error = %v", response.StatusCode, message, err)
			}
			if !response.Close {
				t.Error("timed-out request connection should close")
			}
			assertNoImportTemps(t, directory)
			var count int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("notes = %d, error = %v", count, err)
			}

			// The process-wide slot must be reusable, not merely return a timeout
			// while a background reader keeps holding it.
			var archive bytes.Buffer
			if err := export.Build(&archive, []*notes.Note{{Title: "Retry", Body: "body"}}, nil, ""); err != nil {
				t.Fatal(err)
			}
			req := importRequest(t, archive.Bytes(), "")
			retry, err := server.Client().Post(server.URL+"/api/import", req.Header.Get("Content-Type"), req.Body)
			if err != nil {
				t.Fatal(err)
			}
			defer retry.Body.Close()
			if retry.StatusCode != http.StatusCreated {
				t.Fatalf("retry status = %d", retry.StatusCode)
			}
			assertNoImportTemps(t, directory)
		})
	}
}

type shortDeadlineWriter struct{ http.ResponseWriter }

func (w shortDeadlineWriter) SetReadDeadline(deadline time.Time) error {
	if !deadline.IsZero() {
		deadline = time.Now().Add(100 * time.Millisecond)
	}
	return http.NewResponseController(w.ResponseWriter).SetReadDeadline(deadline)
}

func assertNoImportTemps(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary files remain: %v, %v", entries, err)
	}
}

func TestHandler_RequiresAuthentication(t *testing.T) {
	handler, _, _ := importHandlerFixture(t)
	response := httptest.NewRecorder()
	handler.Import(response, importRequest(t, makeZIP(t, map[string][]byte{"note.md": []byte("# Note\n\n\n")}), ""))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func importHandlerFixture(t *testing.T) (*importer.Handler, *auth.User, *db.DB) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	user, err := auth.NewUserRepo(database).Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	service := importer.NewService(database, importer.DefaultConfig())
	return importer.NewHandler(service), user, database
}

// Direct handler tests have no socket; real deadline enforcement is covered by
// TestHandler_StalledUploadsTimeOutAndReleaseAdmission above.
type importRecorder struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func newImportRecorder() *importRecorder {
	return &importRecorder{ResponseRecorder: httptest.NewRecorder()}
}
func (r *importRecorder) SetReadDeadline(deadline time.Time) error {
	r.deadlines = append(r.deadlines, deadline)
	return nil
}

func importRequest(t *testing.T, archive []byte, password string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("archive", "backup.zip")
	if err != nil {
		t.Fatalf("create archive field: %v", err)
	}
	if _, err := file.Write(archive); err != nil {
		t.Fatalf("write archive field: %v", err)
	}
	if password != "" {
		if err := writer.WriteField("password", password); err != nil {
			t.Fatalf("write password: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/import", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}
