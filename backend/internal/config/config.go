package config

import (
	"os"
	"path/filepath"
	"strconv"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	// Server
	Port string

	// Database
	DBPath string

	// Music
	MusicDir        string
	ArtworkCacheDir string

	// Admin seed
	AdminUsername string
	AdminPassword string

	// Security
	JWTSecret       string
	SessionTTLHours int
	AllowedOrigins  string // comma-separated, e.g. "http://192.168.1.5:3000"

	// Subsonic
	SubsonicURL      string
	SubsonicUsername string
	SubsonicPassword string
	SubsonicEnabled  bool

	// YouTube integration (mobile QR flow)
	YouTubeAPIKey    string
	ExternalMusicDir string

	// Feature flags
	AllowGuestSearch      bool
	AllowGuestQueueAdd    bool
	AllowGuestPartyButton bool

	// Auto-scan: interval in minutes to automatically re-scan the music directory.
	// 0 disables periodic auto-scan (manual rescan via admin UI still works).
	AutoScanIntervalMins int
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:            getEnv("PORT", "8080"),
		DBPath:          getEnv("DB_PATH", "/data/crownjukebox.db"),
		MusicDir:        getEnv("MUSIC_DIR", "/music"),
		ArtworkCacheDir: getEnv("ARTWORK_CACHE_DIR", "/artwork-cache"),

		AdminUsername: getEnv("ADMIN_USERNAME", "admin"),
		AdminPassword: getEnv("ADMIN_PASSWORD", ""),

		JWTSecret:       getEnv("JWT_SECRET", "change-this-secret-in-production"),
		SessionTTLHours: getEnvInt("SESSION_TTL_HOURS", 24),
		AllowedOrigins:  getEnv("ALLOWED_ORIGINS", "*"),

		SubsonicURL:      getEnv("SUBSONIC_URL", ""),
		SubsonicUsername: getEnv("SUBSONIC_USERNAME", ""),
		SubsonicPassword: getEnv("SUBSONIC_PASSWORD", ""),
		SubsonicEnabled:  getEnvBool("SUBSONIC_ENABLED", false),

		YouTubeAPIKey:    getEnv("YOUTUBE_API_KEY", ""),
		ExternalMusicDir: getEnv("EXTERNAL_MUSIC_DIR", "/data/external"),

		AllowGuestSearch:      getEnvBool("ALLOW_GUEST_SEARCH", true),
		AllowGuestQueueAdd:    getEnvBool("ALLOW_GUEST_QUEUE_ADD", true),
		AllowGuestPartyButton: getEnvBool("ALLOW_GUEST_PARTY_BUTTON", false),

		AutoScanIntervalMins: getEnvInt("SCAN_INTERVAL_MINUTES", 10),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func GlobalPartyUploadsDir(dbPath string) string {
	baseDir := filepath.Dir(dbPath)
	if baseDir == "." || baseDir == "" {
		baseDir = "/data"
	}
	return filepath.Join(baseDir, "skale_uploads")
}
