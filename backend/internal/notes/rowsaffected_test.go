package notes_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/danpicton/crapnote/internal/notes"
)

var (
	errRowsAffected                 = errors.New("rows affected unavailable")
	registerRowsAffectedErrorDriver sync.Once
)

type rowsAffectedErrorDriver struct{}

type rowsAffectedErrorConn struct{}

type rowsAffectedErrorResult struct{}

func (rowsAffectedErrorDriver) Open(string) (driver.Conn, error) {
	return rowsAffectedErrorConn{}, nil
}

func (rowsAffectedErrorConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (rowsAffectedErrorConn) Close() error { return nil }

func (rowsAffectedErrorConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported")
}

func (rowsAffectedErrorConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return rowsAffectedErrorResult{}, nil
}

func (rowsAffectedErrorResult) LastInsertId() (int64, error) { return 0, nil }

func (rowsAffectedErrorResult) RowsAffected() (int64, error) {
	return 0, errRowsAffected
}

func openRowsAffectedErrorDB(t *testing.T) *sql.DB {
	t.Helper()
	registerRowsAffectedErrorDriver.Do(func() {
		sql.Register("notes_rows_affected_error", rowsAffectedErrorDriver{})
	})
	database, err := sql.Open("notes_rows_affected_error", "")
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestNoteRepo_SetBoolWriters_PropagateRowsAffectedError(t *testing.T) {
	repo := notes.NewRepo(openRowsAffectedErrorDB(t))
	writers := map[string]func() error{
		"starred": func() error { return repo.SetStarred(context.Background(), 1, 2, true) },
		"locked":  func() error { return repo.SetLocked(context.Background(), 1, 2, true) },
		"archived": func() error {
			return repo.Archive(context.Background(), 1, 2)
		},
	}

	for column, write := range writers {
		err := write()
		if !errors.Is(err, errRowsAffected) {
			t.Errorf("set %s: expected RowsAffected error, got %v", column, err)
		}
		if err == nil || !strings.Contains(err.Error(), "set "+column) {
			t.Errorf("set %s: error lacks operation context: %v", column, err)
		}
	}
}

func TestNoteRepo_SetPinned_PropagatesRowsAffectedError(t *testing.T) {
	repo := notes.NewRepo(openRowsAffectedErrorDB(t))

	err := repo.SetPinned(context.Background(), 1, 2, true)
	if !errors.Is(err, errRowsAffected) {
		t.Fatalf("expected RowsAffected error, got %v", err)
	}
	if !strings.Contains(err.Error(), "set pinned") {
		t.Fatalf("error lacks operation context: %v", err)
	}
}

func TestNoteRepo_Unarchive_PropagatesRowsAffectedError(t *testing.T) {
	repo := notes.NewRepo(openRowsAffectedErrorDB(t))

	err := repo.Unarchive(context.Background(), 1, 2)
	if !errors.Is(err, errRowsAffected) {
		t.Fatalf("expected RowsAffected error, got %v", err)
	}
	if !strings.Contains(err.Error(), "unarchive") {
		t.Fatalf("error lacks operation context: %v", err)
	}
}

func TestNoteRepo_HardDelete_PropagatesRowsAffectedError(t *testing.T) {
	repo := notes.NewRepo(openRowsAffectedErrorDB(t))

	err := repo.HardDelete(context.Background(), 1, 2)
	if !errors.Is(err, errRowsAffected) {
		t.Fatalf("expected RowsAffected error, got %v", err)
	}
	if !strings.Contains(err.Error(), "hard delete") {
		t.Fatalf("error lacks operation context: %v", err)
	}
}

func TestNoteRepo_Update_PropagatesRowsAffectedError(t *testing.T) {
	repo := notes.NewRepo(openRowsAffectedErrorDB(t))

	_, err := repo.Update(context.Background(), 1, 2, nil, nil)
	if !errors.Is(err, errRowsAffected) {
		t.Fatalf("expected RowsAffected error, got %v", err)
	}
	if !strings.Contains(err.Error(), "update note") {
		t.Fatalf("error lacks operation context: %v", err)
	}
}

var _ driver.Driver = rowsAffectedErrorDriver{}
var _ driver.ExecerContext = rowsAffectedErrorConn{}
