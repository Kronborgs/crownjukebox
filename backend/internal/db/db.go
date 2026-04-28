package db

import (
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite" // pure-Go SQLite driver, no CGO
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens (or creates) the SQLite database at the given path.
func Open(dsn string) (*sqlx.DB, error) {
	db, err := sqlx.Open("sqlite", dsn+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite is single-writer
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return db, nil
}

// Migrate runs all SQL migration files embedded in the migrations/ folder.
// Files are run in lexicographic order. Already-applied migrations are tracked
// in the schema_migrations table.
func Migrate(db *sqlx.DB) error {
	// Ensure tracking table exists
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	// List migration files
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	// Sort for deterministic order
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		version := entry.Name()

		// Check if already applied
		var count int
		if err := db.Get(&count, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version); err != nil {
			return fmt.Errorf("check migration %s: %w", version, err)
		}
		if count > 0 {
			continue // already applied
		}

		// Read and execute
		sql, err := migrationsFS.ReadFile("migrations/" + version)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}

		if _, err := db.Exec(string(sql)); err != nil {
			// Tolerate "duplicate column name" — the column may already exist in the
			// production DB from a hotfix applied before this migration was written.
			if !strings.Contains(err.Error(), "duplicate column name") {
				return fmt.Errorf("execute migration %s: %w", version, err)
			}
			fmt.Printf("[db] migration %s: column already exists, marking as applied\n", version)
		}

		if _, err := db.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			return fmt.Errorf("record migration %s: %w", version, err)
		}

		fmt.Printf("[db] migration applied: %s\n", version)
	}

	return nil
}
