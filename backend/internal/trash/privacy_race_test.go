package trash_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/requestctx"
	"github.com/danpicton/crapnote/internal/trash"
	"github.com/mattn/go-sqlite3"
)

// Forward every operation to the leased, real SQLite connection, scheduling
// a commit on a second connection just before the repository's DELETE. SQL
// results are never mocked, and the driver connection never escapes Raw.
type deleteConnector struct{ conn *deleteConn }

func (c deleteConnector) Connect(context.Context) (driver.Conn, error) { return c.conn, nil }
func (c deleteConnector) Driver() driver.Driver                        { return &sqlite3.SQLiteDriver{} }

type deleteConn struct {
	driver.Conn
	beforeDelete func() error
}

func (c *deleteConn) Close() error { return nil } // original sql.Conn owns it
func (c *deleteConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(query)), "DELETE FROM NOTES") && c.beforeDelete != nil {
		hook := c.beforeDelete
		c.beforeDelete = nil
		if err := hook(); err != nil {
			return nil, err
		}
	}
	return c.Conn.(driver.ExecerContext).ExecContext(ctx, query, args)
}

func TestTrashRepo_DeleteUsesCurrentMembershipAndPrivacy(t *testing.T) {
	for _, origin := range []string{"MCP", "REST"} {
		for _, operation := range []string{"one", "empty"} {
			for _, change := range []string{"restore", "private", "restore and private"} {
				t.Run(origin+"/"+operation+"/"+change, func(t *testing.T) {
					database := openTestDB(t)
					database.SetMaxOpenConns(2)
					userID := seedUser(t, database)
					noteID := seedNote(t, database, userID, "selected then changed")
					otherID := seedNote(t, database, userID, "still in trash")
					trashNote(t, database, noteID, userID)
					trashNote(t, database, otherID, userID)
					ctx := context.Background()
					if origin == "MCP" {
						ctx = requestctx.WithMCP(ctx)
					}
					leased, err := database.Conn(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer leased.Close()
					changed := false
					err = leased.Raw(func(raw any) error {
						instrumented := sql.OpenDB(deleteConnector{&deleteConn{
							Conn: raw.(driver.Conn),
							beforeDelete: func() error {
								tx, err := database.BeginTx(context.Background(), nil)
								if err != nil {
									return err
								}
								defer tx.Rollback() //nolint:errcheck
								if strings.Contains(change, "restore") {
									if _, err := tx.Exec(`DELETE FROM trash WHERE note_id=?`, noteID); err != nil {
										return err
									}
								}
								if strings.Contains(change, "private") {
									if _, err := tx.Exec(`UPDATE notes SET private=1 WHERE id=?`, noteID); err != nil {
										return err
									}
								}
								if err := tx.Commit(); err != nil {
									return err
								}
								changed = true
								return nil
							},
						}})
						instrumented.SetMaxOpenConns(1)
						defer instrumented.Close()
						repo := trash.NewRepo(instrumented)
						if operation == "one" {
							return repo.DeleteOne(ctx, noteID, userID)
						}
						return repo.Empty(ctx, userID)
					})
					if !changed {
						t.Fatal("competing transaction did not commit")
					}
					survives := change != "private" || origin == "MCP"
					var wantErr error
					if operation == "one" && survives {
						wantErr = trash.ErrNotFound
					}
					if err != wantErr {
						t.Errorf("delete error = %v, want %v", err, wantErr)
					}
					var count int
					if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, noteID).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if (count == 1) != survives {
						t.Errorf("note count = %d, want survives=%v", count, survives)
					}
					if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, otherID).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if (count == 0) != (operation == "empty") {
						t.Errorf("untouched trash note count = %d after %s", count, operation)
					}
				})
			}
		}
	}
}
