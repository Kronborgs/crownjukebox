package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"

	"github.com/crownjukebox/crownjukebox/internal/api"
	"github.com/crownjukebox/crownjukebox/internal/artwork"
	"github.com/crownjukebox/crownjukebox/internal/config"
	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
	"github.com/crownjukebox/crownjukebox/internal/music"
)

// Version is set at build time via -ldflags "-X main.Version=<git-sha>"
var Version = "dev"

func main() {
	cfg := config.Load()

	log.Printf("CrownJukebox starting on port %s", cfg.Port)
	log.Printf("Music dir:        %s", cfg.MusicDir)
	log.Printf("Artwork cache:    %s", cfg.ArtworkCacheDir)
	log.Printf("Database:         %s", cfg.DBPath)

	// Optional one-time full DB reset before opening the database.
	if err := resetDatabaseIfRequested(cfg.DBPath); err != nil {
		log.Fatalf("DB reset failed: %v", err)
	}

	// ─── Database ──────────────────────────────────────────
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}

	// One-time idempotent fix: any tracks inside the party-uploads directory that
	// were incorrectly indexed as source_type='local' (e.g. uploaded before the
	// IndexPartyFile marker was in place) get corrected to 'party_upload' so they
	// are excluded from the regular library browser, queue, and broken-file stats.
	{
		uploadsDir := config.GlobalPartyUploadsDir(cfg.DBPath)
		if !strings.HasSuffix(uploadsDir, "/") {
			uploadsDir += "/"
		}
		if res, err := database.Exec(
			`UPDATE tracks SET source_type = 'party_upload' WHERE source_type = 'local' AND file_path LIKE ?`,
			uploadsDir+"%",
		); err != nil {
			log.Printf("[startup] source_type fix warning: %v", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			log.Printf("[startup] corrected source_type for %d SKÅL upload track(s) in %s", n, uploadsDir)
		}
	}

	// ─── Seed admin user ──────────────────────────────────
	if err := seedAdmin(database, cfg); err != nil {
		log.Printf("[seed] admin seed warning: %v", err)
	}

	// ─── Ensure cache directories exist ───────────────────
	for _, dir := range []string{
		cfg.ArtworkCacheDir,
		cfg.ArtworkCacheDir + "/originals",
		cfg.ArtworkCacheDir + "/thumbs/small",
		cfg.ArtworkCacheDir + "/thumbs/medium",
		cfg.ArtworkCacheDir + "/thumbs/large",
		cfg.ArtworkCacheDir + "/placeholders",
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("Warning: could not create dir %s: %v", dir, err)
		}
	}

	// ─── Background: initial library scan ─────────────────
	go func() {
		log.Println("[startup] beginning initial library scan...")
		scanner := music.NewScanner(database, cfg.MusicDir)
		if err := scanner.Scan(nil); err != nil {
			log.Printf("[startup] scan error: %v", err)
		} else {
			log.Println("[startup] library scan complete")

			// Follow up with artwork extraction
			extractor := artwork.NewExtractor(database, cfg.ArtworkCacheDir)
			log.Println("[startup] extracting missing artwork...")
			if err := extractor.ExtractMissing(nil); err != nil {
				log.Printf("[startup] artwork extraction error: %v", err)
			} else {
				log.Println("[startup] artwork extraction complete")
			}
		}
	}()

	// ─── HTTP server ─────────────────────────────────────
	srv := api.NewServer(cfg, database, Version)
	router := srv.Router()

	// ─── Background: periodic auto-scan ───────────────────
	// Re-scans the music directory every SCAN_INTERVAL_MINUTES (default 10)
	// to pick up new files and remove orphaned DB entries automatically.
	if cfg.AutoScanIntervalMins > 0 {
		go func() {
			ticker := time.NewTicker(time.Duration(cfg.AutoScanIntervalMins) * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				if srv.TriggerBackgroundScan() {
					log.Printf("[autoscan] periodic scan started (every %d min)", cfg.AutoScanIntervalMins)
				}
			}
		}()
	}

	// ─── Background: expire user access ───────────────────
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			var expired []db.User
			if err := database.Select(&expired, `
				SELECT * FROM users
				WHERE is_active = 1
				  AND is_permanent = 0
				  AND access_expires_at IS NOT NULL
				  AND access_expires_at <= CURRENT_TIMESTAMP`); err != nil {
				continue
			}
			for _, u := range expired {
				database.Exec(`UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, u.ID)
				srv.Hub().BroadcastToUser(u.ID, events.EventUserAccessExpired, map[string]any{"user_id": u.ID})
				_ = srv.AuthService().RevokeAllUserSessions(context.Background(), u.ID)
				log.Printf("[access] user %s (%s) access expired — logged out", u.ID, u.DisplayName)
			}
		}
	}()

	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // 0 = no timeout (needed for SSE streams)
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("Listening on http://0.0.0.0:%s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down gracefully...")

	srv.RoomService().Stop()
	srv.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}
	log.Println("Goodbye!")
}

// resetDatabaseIfRequested performs a full DB reset when RESET_SETUP_ON_START=CONFIRM.
// This gives a true fresh-install state.
func resetDatabaseIfRequested(dbPath string) error {
	flagRaw := strings.TrimSpace(os.Getenv("RESET_SETUP_ON_START"))
	flag := strings.Trim(flagRaw, "\"'")
	if flag == "" || flag == "0" || strings.EqualFold(flag, "false") {
		return nil
	}

	log.Printf("[reset] RESET_SETUP_ON_START received value: %q", flagRaw)

	// Accept exact CONFIRM and tolerant variants that contain CONFIRM.
	if !(strings.EqualFold(flag, "confirm") || strings.Contains(strings.ToLower(flag), "confirm")) {
		log.Printf("[reset] RESET_SETUP_ON_START is set but not CONFIRM; skipping reset for safety")
		return nil
	}

	if strings.TrimSpace(dbPath) == "" {
		log.Printf("[reset] db path is empty; skipping reset")
		return nil
	}

	log.Printf("[reset] RESET_SETUP_ON_START=CONFIRM detected — removing database files for full reset")
	for _, p := range []string{dbPath, dbPath + "-wal", dbPath + "-shm", dbPath + "-journal"} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	log.Printf("[reset] full DB reset complete — remove RESET_SETUP_ON_START env var now")
	return nil
}

// seedAdmin keeps backward compatibility for env-based admin seeding.
// New setup flow rules:
//   - If ADMIN_PASSWORD env var is explicitly provided (non-empty) → seed/sync admin from env
//   - If ADMIN_PASSWORD env var is empty → do NOT auto-create admin
//   - Fresh installs without ADMIN_PASSWORD should use the setup wizard in the web UI
func seedAdmin(database *sqlx.DB, cfg *config.Config) error {
	// Check if the env var was explicitly set (non-empty raw value).
	explicitPassword := os.Getenv("ADMIN_PASSWORD")

	var count int
	if err := database.Get(&count, `SELECT COUNT(*) FROM users WHERE role = 'admin'`); err != nil {
		return err
	}

	// Admin already exists — keep or sync their password.
	if count > 0 {
		// Always mark setup as completed so the web UI won't show the setup wizard.
		_, _ = database.Exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_completed', '1')`)
		if explicitPassword != "" {
			// Env var is set — sync it to the DB.
			hash, err := bcrypt.GenerateFromPassword([]byte(explicitPassword), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			_, err = database.Exec(`UPDATE users SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE role = 'admin'`, string(hash))
			if err != nil {
				return err
			}
			log.Printf("[seed] admin password synced from ADMIN_PASSWORD env var")
		} else {
			// Env var is empty (e.g. Unraid reset it) — keep whatever is in the DB.
			log.Printf("[seed] admin password loaded from database (ADMIN_PASSWORD env var not configured)")
		}
		return nil
	}

	// First boot with no explicit env password:
	// leave DB without admin and let setup wizard create it.
	if explicitPassword == "" {
		log.Printf("[seed] no ADMIN_PASSWORD provided — skipping env admin seed; setup wizard will create admin")
		return nil
	}

	// First boot — create admin user from explicit env password.
	password := explicitPassword
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	adminID := uuid.NewString()
	_, err = database.Exec(`
		INSERT INTO users (id, display_name, username, role, pin_hash, is_active, is_permanent, created_at, updated_at)
		VALUES (?, ?, ?, 'admin', ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		adminID, cfg.AdminUsername, cfg.AdminUsername, string(hash),
	)
	if err != nil {
		return err
	}

	// Admin gets all permissions
	_, err = database.Exec(`
		INSERT INTO user_permissions (user_id, can_add_to_queue, can_search, can_use_party_button, can_view_queue)
		VALUES (?, 1, 1, 1, 1)`, adminID)

	log.Printf("[seed] admin user created: %s", cfg.AdminUsername)
	return err
}
