package tags_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/requestctx"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/mattn/go-sqlite3"
)

// Schedule an actual committed SQLite update immediately before the mutation
// reaches SQLite. No SQL results or repository methods are mocked: reads and
// writes all use the migrated in-memory database. The leased driver connection
// is only used inside Raw, and its original sql.Conn retains ownership.
type mutationConnector struct{ conn *mutationConn }

func (c mutationConnector) Connect(context.Context) (driver.Conn, error) { return c.conn, nil }
func (c mutationConnector) Driver() driver.Driver                        { return &sqlite3.SQLiteDriver{} }

type mutationConn struct {
	driver.Conn
	beforeMutation func() error
}

func (c *mutationConn) Close() error { return nil } // owned by the outer sql.Conn
func (c *mutationConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	q := strings.ToUpper(strings.TrimSpace(query))
	if (strings.HasPrefix(q, "INSERT") || strings.HasPrefix(q, "DELETE")) && strings.Contains(q, "NOTE_TAGS") && c.beforeMutation != nil {
		hook := c.beforeMutation
		c.beforeMutation = nil
		if err := hook(); err != nil {
			return nil, err
		}
	}
	return c.Conn.(driver.ExecerContext).ExecContext(ctx, query, args)
}

func TestTagRepo_MutationRechecksCommittedPrivacy(t *testing.T) {
	for _, origin := range []string{"MCP", "REST"} {
		for _, operation := range []string{"add", "remove", "add tag becoming private-only"} {
			t.Run(origin+"/"+operation, func(t *testing.T) {
				database := openTestDB(t)
				database.SetMaxOpenConns(2)
				userID := seedUser(t, database)
				noteID := seedNote(t, database, userID, "target")
				repo := tags.NewRepo(database)
				ctx := context.Background()
				tag, err := repo.Create(ctx, userID, "confidential tag")
				if err != nil {
					t.Fatal(err)
				}
				privateID := noteID
				wantCount := 0
				switch operation {
				case "remove":
					if err := repo.AddToNote(ctx, noteID, tag.ID, userID); err != nil {
						t.Fatal(err)
					}
					wantCount = 1
				case "add tag becoming private-only":
					privateID = seedNote(t, database, userID, "other note with tag")
					if err := repo.AddToNote(ctx, privateID, tag.ID, userID); err != nil {
						t.Fatal(err)
					}
				}
				if origin == "MCP" {
					ctx = requestctx.WithMCP(ctx)
				} else {
					wantCount = 1 - wantCount
				}

				leased, err := database.Conn(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer leased.Close()
				changed := false
				err = leased.Raw(func(raw any) error {
					instrumented := sql.OpenDB(mutationConnector{&mutationConn{
						Conn: raw.(driver.Conn),
						beforeMutation: func() error {
							// A separate connection commits before the association write.
							_, err := database.ExecContext(context.Background(), `UPDATE notes SET private=1 WHERE id=?`, privateID)
							changed = err == nil
							return err
						},
					}})
					instrumented.SetMaxOpenConns(1)
					defer instrumented.Close()
					racingRepo := tags.NewRepo(instrumented)
					if operation == "remove" {
						return racingRepo.RemoveFromNote(ctx, noteID, tag.ID, userID)
					}
					return racingRepo.AddToNote(ctx, noteID, tag.ID, userID)
				})
				if !changed {
					t.Fatal("privacy update did not commit before mutation")
				}
				if origin == "MCP" && err != tags.ErrNotFound {
					t.Errorf("mutation error = %v, want ErrNotFound", err)
				}
				if origin == "REST" && err != nil {
					t.Errorf("direct mutation failed: %v", err)
				}
				var count int
				if err := database.QueryRow(`SELECT COUNT(*) FROM note_tags WHERE note_id=? AND tag_id=?`, noteID, tag.ID).Scan(&count); err != nil {
					t.Fatal(err)
				}
				if count != wantCount {
					t.Fatalf("association count = %d, want %d after committed privacy change", count, wantCount)
				}
			})
		}
	}
}
