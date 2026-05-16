package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"

	"github.com/crownjukebox/crownjukebox/internal/artwork"
	"github.com/crownjukebox/crownjukebox/internal/auth"
	"github.com/crownjukebox/crownjukebox/internal/config"
	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/email"
	"github.com/crownjukebox/crownjukebox/internal/events"
	"github.com/crownjukebox/crownjukebox/internal/external"
	"github.com/crownjukebox/crownjukebox/internal/music"
	"github.com/crownjukebox/crownjukebox/internal/musicbrainz"
	"github.com/crownjukebox/crownjukebox/internal/rooms"
)

type contextKey string

const roomContextKey contextKey = "room"

// Server holds all service dependencies.
type Server struct {
	cfg           *config.Config
	version       string
	db            *sqlx.DB
	hub           *events.Hub
	authSvc       *auth.Service
	qrSvc         *auth.QRService
	roomSvc       *rooms.Service
	emailSvc      *email.Service
	artExt        *artwork.Extractor
	scanner       *music.Scanner
	startTime     time.Time
	loginRL       *auth.LoginRateLimiter
	externalStore *external.Store

	// scan state — protected by scanMu
	scanMu      sync.RWMutex
	libraryScan *libraryScanInfo
	artworkScan *artworkScanInfo
	bpmScan     *bpmScanInfo

	// music folder size cache — refreshed at most every 5 minutes
	musicSizeMu    sync.Mutex
	musicSizeBytes int64
	musicFileCount int64
	musicSizeAt    time.Time
}

type libraryScanInfo struct {
	Total       int    `json:"total"`
	Scanned     int    `json:"scanned"`
	CurrentFile string `json:"current_file"`
}

type artworkScanInfo struct {
	Total     int `json:"total"`
	Processed int `json:"processed"`
}

type bpmScanInfo struct {
	Total     int `json:"total"`
	Processed int `json:"processed"`
}

// NewServer creates the API server with all wired dependencies.
func NewServer(cfg *config.Config, database *sqlx.DB, version string) *Server {
	hub := events.NewHub()
	authSvc := auth.NewService(database, cfg.SessionTTLHours)
	qrSvc := auth.NewQRService(database, getBaseURL(cfg))
	roomSvc := rooms.New(database, hub)
	emailSvc := email.NewService(database)
	artExt := artwork.NewExtractor(database, cfg.ArtworkCacheDir)
	scanner := music.NewScanner(database, cfg.MusicDir)

	return &Server{
		cfg:           cfg,
		version:       version,
		db:            database,
		hub:           hub,
		authSvc:       authSvc,
		qrSvc:         qrSvc,
		roomSvc:       roomSvc,
		emailSvc:      emailSvc,
		artExt:        artExt,
		scanner:       scanner,
		startTime:     time.Now(),
		loginRL:       auth.NewLoginRateLimiter(),
		externalStore: external.NewStore(),
	}
}

func getBaseURL(cfg *config.Config) string {
	if v := cfg.SubsonicURL; v != "" {
		return v
	}
	return "http://localhost:" + cfg.Port
}

// getPublicBaseURL returns the configured jukebox_url from settings (DB).
// Falls back to getBaseURL(cfg) if not set, and also returns whether it was
// explicitly configured (so callers can warn the user).
func (s *Server) getPublicBaseURL(ctx context.Context) (url string, configured bool) {
	var val string
	if err := s.db.GetContext(ctx, &val, `SELECT value FROM settings WHERE key = 'jukebox_url'`); err == nil {
		val = strings.TrimRight(strings.TrimSpace(val), "/")
		if val != "" {
			return val, true
		}
	}
	return getBaseURL(s.cfg), false
}

// resolveBaseURL picks the best base URL for invitation links:
// 1. clientOrigin (sent by browser — window.location.origin)
// 2. jukebox_url setting in DB
// 3. fallback localhost
func (s *Server) resolveBaseURL(ctx context.Context, clientOrigin string) string {
	clientOrigin = strings.TrimRight(strings.TrimSpace(clientOrigin), "/")
	if clientOrigin != "" {
		return clientOrigin
	}
	url, _ := s.getPublicBaseURL(ctx)
	return url
}

// Hub returns the SSE event hub (used by main for background broadcast goroutines).
func (s *Server) Hub() *events.Hub {
	return s.hub
}

// AuthService returns the auth service (used by main for session revocation).
func (s *Server) AuthService() *auth.Service {
	return s.authSvc
}

// Router builds and returns the chi router with all routes.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   strings.Split(s.cfg.AllowedOrigins, ","),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Session-Token", "X-Room-ID"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// ─── Public endpoints ─────────────────────────────────────
	r.Get("/healthz", s.handleHealthz)
	r.Post("/api/auth/login", s.handleLogin)
	r.Post("/api/auth/qr-login", s.handleQRLogin)
	r.Get("/api/setup/status", s.handleSetupStatus)
	r.Post("/api/setup", s.handleSetupComplete)
	r.Get("/api/library/cover/{id}", s.handleCoverArt) // cover art served publicly (no sensitive data)

	// ─── External / mobile QR endpoints (session-scoped, no jukebox auth) ────
	r.Get("/api/external/status", s.handleExternalStatus)
	r.Get("/api/external/youtube/search", s.handleExternalYouTubeSearch)
	r.Post("/api/external/queue-song", s.handleExternalQueueSong)

	// ─── Authenticated endpoints ──────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(s.authSvc))
		r.Use(s.roomMiddleware)

		r.Post("/api/auth/logout", s.handleLogout)
		r.Get("/api/auth/me", s.handleMe)
		r.Post("/api/auth/set-pin", s.handleSetPin)
		r.Post("/api/auth/guest-link", s.handleCreateGuestLink)

		// Library
		r.Get("/api/library/artists", s.handleListArtists)
		r.Get("/api/library/albums", s.handleListAlbums)
		r.Get("/api/library/albums/{id}", s.handleGetAlbum)
		r.Get("/api/library/albums/{id}/tracks", s.handleGetAlbumTracks)
		r.Get("/api/library/tracks/{id}", s.handleGetTrack)
		r.Get("/api/library/search", auth.RequirePermission(s.authSvc, "can_search")(http.HandlerFunc(s.handleSearch)).ServeHTTP)
		r.Get("/api/library/missing-covers", s.handleMissingCovers)

		// Rooms (list available rooms — all authenticated users)
		r.Get("/api/rooms", s.handleListRooms)

		// Queue
		r.Get("/api/queue", auth.RequirePermission(s.authSvc, "can_view_queue")(http.HandlerFunc(s.handleGetQueue)).ServeHTTP)
		r.Get("/api/queue/next", s.handleQueuePeekNext)
		r.Post("/api/queue", auth.RequirePermission(s.authSvc, "can_add_to_queue")(http.HandlerFunc(s.handleAddToQueue)).ServeHTTP)
		r.Delete("/api/queue/{id}", s.handleRemoveFromQueue)
		r.Post("/api/queue/reorder", s.handleReorderQueue)

		// Playback
		r.Get("/api/playback/state", s.handlePlaybackState)
		r.Post("/api/playback/play", s.handlePlay)
		r.Post("/api/playback/pause", s.handlePause)
		r.Post("/api/playback/skip", s.handleSkip)
		r.Post("/api/playback/track-ended", s.handleTrackEnded)
		r.Get("/api/playback/stream/{trackId}", s.handleStream)
		r.Get("/api/playback/history", s.handlePlaybackHistory)
		r.Post("/api/playback/position", s.handleUpdatePosition)

		// Phase 2: Active player session claim/release
		r.Post("/api/playback/claim-player", s.handleClaimPlayer)
		r.Post("/api/playback/release-player", s.handleReleasePlayer)

		// Phase 3: Audio state (volume, balance, tone, mute)
		r.Put("/api/playback/audio-state", s.handleUpdateAudioState)
		r.Get("/api/playback/audio-state", s.handleGetAudioState)

		// Party
		r.Post("/api/party/cheers", auth.RequirePermission(s.authSvc, "can_use_party_button")(http.HandlerFunc(s.handleCheers)).ServeHTTP)
		r.Post("/api/party/end", s.handlePartyEnd)
		r.Get("/api/party/state", s.handlePartyState)

		// Public read-only settings (e.g. queue_confirm_add used by regular users)
		r.Get("/api/settings", s.handleGetSettings)

		// SSE (room_id via query param for EventSource)
		r.Get("/api/events", s.handleSSE)

		// External session creation (jukebox user initiates mobile QR flow)
		r.Post("/api/external/session", s.handleCreateExternalSession)
	})

	// ─── Admin endpoints ──────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAdmin(s.authSvc))

		// Users
		r.Get("/api/admin/users", s.handleAdminListUsers)
		r.Post("/api/admin/users", s.handleAdminCreateUser)
		r.Get("/api/admin/users/{id}", s.handleAdminGetUser)
		r.Patch("/api/admin/users/{id}", s.handleAdminUpdateUser)
		r.Post("/api/admin/users/{id}/disable", s.handleAdminDisableUser)
		r.Post("/api/admin/users/{id}/enable", s.handleAdminEnableUser)
		r.Post("/api/admin/users/{id}/extend", s.handleAdminExtendUser)
		r.Delete("/api/admin/users/{id}", s.handleAdminDeleteUser)
		r.Put("/api/admin/users/{id}/password", s.handleAdminChangePassword)

		// Invite user via email
		r.Post("/api/admin/users/{id}/invite", s.handleAdminInviteUser)

		// Rooms management
		r.Post("/api/admin/rooms", s.handleAdminCreateRoom)
		r.Delete("/api/admin/rooms/{id}", s.handleAdminDeleteRoom)
		r.Put("/api/admin/rooms/{id}/party-playlist", s.handleAdminSetRoomPartyPlaylist)

		// Access links / QR
		r.Post("/api/admin/access-links", s.handleAdminCreateAccessLink)
		r.Get("/api/admin/access-links", s.handleAdminListAccessLinks)
		r.Post("/api/admin/access-links/{id}/revoke", s.handleAdminRevokeAccessLink)
		r.Get("/api/admin/access-links/{id}/qr", s.handleAdminAccessLinkQR)

		// Sessions
		r.Get("/api/admin/sessions", s.handleAdminListSessions)
		r.Post("/api/admin/sessions/{id}/revoke", s.handleAdminRevokeSession)

		// Jukebox/room management
		r.Get("/api/admin/jukeboxes", s.handleAdminListJukeboxes)

		// Settings & scanning
		r.Put("/api/settings", s.handleUpdateSettings)
		r.Get("/api/admin/scan-status", s.handleGetScanStatus)
		r.Post("/api/admin/rescan", s.handleRescan)
		r.Post("/api/admin/rescan-artwork", s.handleRescanArtwork)
		r.Post("/api/admin/rescan-missing-artwork", s.handleRescanMissingArtwork)
		r.Post("/api/admin/analyze-bpm", s.handleAnalyzeBPM)
		r.Post("/api/admin/analyze-bpm-all", s.handleAnalyzeBPMAll)
		r.Post("/api/admin/library/reset", s.handleResetLibrary)
		r.Get("/api/admin/library/broken-files", s.handleListBrokenFiles)
		r.Post("/api/admin/library/broken-files/repair", s.handleRepairBrokenFiles)
		r.Delete("/api/admin/library/tracks/{id}", s.handleDeleteTrack)
		r.Get("/api/admin/missing-artwork", s.handleAdminMissingArtwork)
		// MusicBrainz / album fixer
		r.Get("/api/admin/fragmented-albums", s.handleFragmentedAlbums)
		r.Get("/api/admin/musicbrainz/search", s.handleMusicBrainzSearch)
		r.Post("/api/admin/merge-albums", s.handleMergeAlbums)
		r.Get("/api/admin/keyboard-bindings", s.handleGetKeyboardBindings)
		r.Put("/api/admin/keyboard-bindings", s.handleUpdateKeyboardBindings)

		// Party playlist management
		r.Get("/api/admin/playlists", s.handleListPlaylists)
		r.Get("/api/admin/playlists/skaal", s.handleListSkaalPlaylists)
		r.Post("/api/admin/playlists", s.handleCreatePlaylist)
		r.Patch("/api/admin/playlists/{id}", s.handleUpdatePlaylist)
		r.Delete("/api/admin/playlists/{id}", s.handleDeletePlaylist)
		r.Post("/api/admin/playlists/{id}/tracks", s.handleAddPlaylistTrack)
		r.Delete("/api/admin/playlists/{id}/tracks/{trackId}", s.handleRemovePlaylistTrack)
		r.Get("/api/admin/playlists/{id}/tracks", s.handleGetPlaylistTracks)
		r.Put("/api/admin/playlists/{id}/intro-track", s.handleSetPlaylistIntroTrack)
		r.Put("/api/admin/playlists/{id}/track-order", s.handleSetPlaylistTrackOrder)
		r.Post("/api/admin/party-playlist/upload", s.handleUploadPartyPlaylistTracks)

		// Party uploads library (uploaded files not yet in any playlist)
		r.Post("/api/admin/party-uploads", s.handleUploadPartyFiles)
		r.Get("/api/admin/party-uploads", s.handleListPartyUploads)
		r.Delete("/api/admin/party-uploads/{id}", s.handleDeletePartyUpload)

		// System monitoring
		r.Get("/api/admin/system-metrics", s.handleSystemMetrics)

		// SMTP settings
		r.Get("/api/admin/smtp", s.handleGetSMTP)
		r.Put("/api/admin/smtp", s.handleUpdateSMTP)
		r.Post("/api/admin/smtp/test", s.handleTestSMTP)

		// YouTube API key
		r.Get("/api/admin/youtube", s.handleGetYouTubeSettings)
		r.Put("/api/admin/youtube", s.handleUpdateYouTubeSettings)
	})

	return r
}

// ─────────────────────────────────────────────────────────────
// Auth handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	// Rate-limit per client IP (10 attempts / 10 min, then 15 min lockout).
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	if allowed, retryAfter := s.loginRL.Check(ip); !allowed {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
		jsonError(w, "too many login attempts, please try again later", http.StatusTooManyRequests)
		return
	}

	// Limit body size to prevent resource exhaustion.
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	var req struct {
		Username   string `json:"username"`
		Pin        string `json:"pin"`
		DeviceName string `json:"device_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	if req.Username == "" || req.Pin == "" {
		jsonError(w, "username and pin required", http.StatusBadRequest)
		return
	}

	var user db.User
	if err := s.db.Get(&user, `
		SELECT id, display_name, username, email, role, pin_hash, login_token_hash,
		       is_active, is_permanent, access_starts_at, access_expires_at,
		       created_by_admin_id, created_at, updated_at, last_seen_at, force_pin_change
		FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1`, req.Username); err != nil {
		// Constant-time delay even on lookup failure to prevent user-enumeration via timing.
		bcrypt.GenerateFromPassword([]byte("dummy"), bcrypt.DefaultCost)
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if !auth.CheckPassword(user.PinHash, req.Pin) {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	deviceName := strings.TrimSpace(req.DeviceName)
	if deviceName == "" {
		deviceName = "Browser"
	}
	token, err := s.authSvc.CreateSession(r.Context(), user.ID,
		deviceName, r.Header.Get("User-Agent"), r.RemoteAddr)
	if err != nil {
		jsonError(w, "session creation failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"token": token,
		"user":  userResponse(user),
	})
}

func (s *Server) handleQRLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	userID, err := s.qrSvc.UseAccessLink(r.Context(), req.Token)
	if err != nil {
		jsonError(w, "invalid or expired QR token", http.StatusUnauthorized)
		return
	}

	var user db.User
	if err := s.db.Get(&user, `SELECT * FROM users WHERE id = ?`, userID); err != nil {
		jsonError(w, "user not found", http.StatusUnauthorized)
		return
	}

	token, err := s.authSvc.CreateGuestSession(r.Context(), user.ID,
		"QR Login", r.Header.Get("User-Agent"), r.RemoteAddr)
	if err != nil {
		jsonError(w, "session creation failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"token": token,
		"user":  userResponse(user),
	})
}

func (s *Server) handleSetPin(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		NewPin string `json:"new_pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.NewPin) < 4 {
		jsonError(w, "new_pin must be at least 4 characters", http.StatusBadRequest)
		return
	}
	hash, err := auth.HashPassword(req.NewPin)
	if err != nil {
		jsonError(w, "hash error", http.StatusInternalServerError)
		return
	}
	if _, err := s.db.ExecContext(r.Context(),
		`UPDATE users SET pin_hash = ?, force_pin_change = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		hash, sd.User.ID,
	); err != nil {
		jsonError(w, "failed to update PIN", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd != nil {
		_ = s.authSvc.RevokeSession(r.Context(), sd.Session.ID)
	}
	jsonOK(w, map[string]string{"status": "logged out"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil {
		jsonError(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	jsonOK(w, map[string]any{
		"user":             userResponse(sd.User),
		"permissions":      sd.Permissions,
		"is_guest_session": sd.Session.IsGuestSession,
		"session_id":       sd.Session.ID,
	})
}

// handleCreateGuestLink creates a 24-hour one-time access link for guests.
// Any authenticated non-guest user can call this to get a QR login URL.
func (s *Server) handleCreateGuestLink(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil || sd.Session.IsGuestSession {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	_, loginURL, err := s.qrSvc.CreateAccessLink(r.Context(), sd.User.ID, 24*time.Hour)
	if err != nil {
		jsonError(w, "failed to create guest link", http.StatusInternalServerError)
		return
	}
	// Replace the internal base URL (localhost fallback from qrSvc) with the real
	// public address so the QR code points to the correct host.
	if idx := strings.Index(loginURL, "/login?token="); idx >= 0 {
		loginURL = s.publicBaseFromRequest(r) + loginURL[idx:]
	}
	jsonOK(w, map[string]string{"login_url": loginURL})
}

// publicBaseFromRequest derives the public base URL from an incoming request.
// Priority:
//  1. Origin header (browsers send this on POST; most reliable when available)
//  2. Host header + scheme heuristic (nginx always forwards Host via proxy_set_header)
//  3. admin-configured jukebox_url DB setting
//  4. localhost fallback
func (s *Server) publicBaseFromRequest(r *http.Request) string {
	// Origin is sent by all browsers for POST/PUT/DELETE even on same-origin requests.
	if origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/"); origin != "" {
		return origin
	}
	// Host is always present (nginx: proxy_set_header Host $host).
	if host := r.Host; host != "" {
		scheme := "https"
		if proto := r.Header.Get("X-Forwarded-Proto"); proto == "http" {
			scheme = "http"
		} else if strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.") {
			scheme = "http"
		}
		return scheme + "://" + host
	}
	// Fall back to admin-configured jukebox_url or localhost.
	url, _ := s.getPublicBaseURL(r.Context())
	return url
}

// ─────────────────────────────────────────────────────────────
// Library handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleListArtists(w http.ResponseWriter, r *http.Request) {
	var artists []db.Artist
	if err := s.db.Select(&artists, `SELECT * FROM artists ORDER BY sort_name ASC`); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, artists)
}

func (s *Server) handleListAlbums(w http.ResponseWriter, r *http.Request) {
	artistID := r.URL.Query().Get("artist_id")
	page := queryInt(r, "page", 1)
	limit := queryInt(r, "limit", 40)
	offset := (page - 1) * limit

	type AlbumWithArtist struct {
		db.Album
		ArtistName string `db:"artist_name" json:"artist_name"`
		CoverSmall string `db:"cover_small"  json:"cover_small"`
	}

	var albums []AlbumWithArtist
	q := `
		SELECT al.*, ar.name as artist_name,
		       COALESCE(aa.small_path, '') as cover_small
		FROM albums al
		LEFT JOIN artists ar ON ar.id = al.artist_id
		LEFT JOIN album_art aa ON aa.id = al.cover_art_id
		WHERE al.source_type != 'party_upload'`

	if artistID != "" {
		s.db.Select(&albums, q+` AND al.artist_id = ? ORDER BY al.year DESC, al.title ASC LIMIT ? OFFSET ?`,
			artistID, limit, offset)
	} else {
		s.db.Select(&albums, q+` ORDER BY al.year DESC, al.title ASC LIMIT ? OFFSET ?`, limit, offset)
	}

	// Inject cover URL
	type AlbumResponse struct {
		AlbumWithArtist
		CoverURL string `json:"cover_url"`
	}

	result := make([]AlbumResponse, len(albums))
	for i, a := range albums {
		coverURL := ""
		if a.CoverArtID != nil && *a.CoverArtID != "" {
			coverURL = "/api/library/cover/" + *a.CoverArtID + "?size=medium"
		}
		result[i] = AlbumResponse{
			AlbumWithArtist: a,
			CoverURL:        coverURL,
		}
	}

	jsonOK(w, result)
}

func (s *Server) handleGetAlbum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var album db.Album
	if err := s.db.Get(&album, `SELECT * FROM albums WHERE id = ?`, id); err != nil {
		jsonError(w, "album not found", http.StatusNotFound)
		return
	}
	jsonOK(w, album)
}

func (s *Server) handleGetAlbumTracks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var tracks []db.Track
	if err := s.db.Select(&tracks, `
		SELECT
			t.id, t.album_id, t.artist_id, t.title,
			t.track_number, t.disc_number, t.duration, t.bpm,
			t.file_path, t.source_type, t.source_id, t.stream_url,
			t.created_at, t.updated_at,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.album_id = ?
		ORDER BY t.disc_number, t.track_number`, id); err != nil {
		jsonError(w, "tracks not found", http.StatusNotFound)
		return
	}
	jsonOK(w, tracks)
}

func (s *Server) handleGetTrack(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var track db.Track
	if err := s.db.Get(&track, `
		SELECT
			t.id, t.album_id, t.artist_id, t.title,
			t.track_number, t.disc_number, t.duration, t.bpm,
			t.file_path, t.source_type, t.source_id, t.stream_url,
			t.created_at, t.updated_at,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.id = ?`, id); err != nil {
		jsonError(w, "track not found", http.StatusNotFound)
		return
	}
	jsonOK(w, track)
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		jsonOK(w, map[string]any{"artists": []any{}, "albums": []any{}, "tracks": []any{}})
		return
	}

	like := "%" + q + "%"

	artists := make([]db.Artist, 0)
	_ = s.db.Select(&artists, `SELECT * FROM artists WHERE name LIKE ? LIMIT 10`, like)

	albums := make([]db.Album, 0)
	_ = s.db.Select(&albums, `SELECT * FROM albums WHERE title LIKE ? LIMIT 20`, like)

	tracks := make([]db.Track, 0)
	_ = s.db.Select(&tracks, `
		SELECT
			t.*,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.title LIKE ? AND t.source_type != 'party_upload'
		LIMIT 30`, like)

	jsonOK(w, map[string]any{
		"artists": artists,
		"albums":  albums,
		"tracks":  tracks,
	})
}

func (s *Server) handleCoverArt(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	size := r.URL.Query().Get("size")
	if size == "" {
		size = "medium"
	}

	if id == "" || id == "null" || id == "undefined" {
		servePlaceholder(w, size)
		return
	}

	var art db.AlbumArt
	if err := s.db.Get(&art, `SELECT * FROM album_art WHERE id = ?`, id); err != nil {
		servePlaceholder(w, size)
		return
	}

	data, mimeType, err := artwork.GetCoverData(s.cfg.ArtworkCacheDir, &art, size)
	if err != nil {
		servePlaceholder(w, size)
		return
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", art.OriginalHash)
	w.Write(data)
}

func (s *Server) handleMissingCovers(w http.ResponseWriter, r *http.Request) {
	var albums []db.Album
	_ = s.db.Select(&albums, `
		SELECT * FROM albums
		WHERE cover_status = 'missing' OR cover_art_id IS NULL OR cover_art_id = ''
		ORDER BY title`)
	jsonOK(w, albums)
}

// ─────────────────────────────────────────────────────────────
// Queue handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleGetQueue(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	items, err := rm.Queue.GetQueue(r.Context())
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, items)
}

// handleQueuePeekNext returns the next track that will play without advancing the queue.
// Used by Auto DJ to preload the next track for crossfade — works for both user-queued
// and autoplay tracks. Pre-queues an autoplay track when the queue is empty so the
// subsequent TrackEnded call dequeues exactly the same track.
func (s *Server) handleQueuePeekNext(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	item, err := rm.Queue.PeekNext(r.Context())
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	if item == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	jsonOK(w, item)
}

func (s *Server) handleAddToQueue(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TrackID string `json:"track_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TrackID == "" {
		jsonError(w, "track_id required", http.StatusBadRequest)
		return
	}

	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}

	rm := getRoomFromCtx(r.Context())
	item, err := rm.Queue.AddTrack(r.Context(), req.TrackID, userID)
	if err != nil {
		if strings.Contains(err.Error(), "already in the queue") {
			// Idempotent: double-click or race — treat as success
			jsonOK(w, map[string]string{"status": "already in queue"})
			return
		}
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Auto-start or skip-to-user-track depending on current playback state:
	// - Nothing playing → start immediately.
	// - Autoplay track playing → skip it immediately and play the user's track.
	// - Normal (user) track playing → track is queued normally, no disruption.
	if curState, _ := rm.Playback.GetState(r.Context()); curState != nil {
		if !curState.IsPlaying || curState.IsAutoplayTrack {
			_ = rm.Queue.ClearAutoplayItems(r.Context())
			_ = rm.Playback.Play(r.Context(), "", userID)
		}
	}

	// Broadcast queue change
	s.broadcastQueueChange(r.Context())

	jsonOK(w, item)
}

func (s *Server) handleRemoveFromQueue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rm := getRoomFromCtx(r.Context())
	if err := rm.Queue.RemoveItem(r.Context(), id); err != nil {
		jsonError(w, "remove failed", http.StatusInternalServerError)
		return
	}
	s.broadcastQueueChange(r.Context())
	jsonOK(w, map[string]string{"status": "removed"})
}

func (s *Server) handleReorderQueue(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	rm := getRoomFromCtx(r.Context())
	if err := rm.Queue.Reorder(r.Context(), req.Order); err != nil {
		jsonError(w, "reorder failed", http.StatusInternalServerError)
		return
	}
	s.broadcastQueueChange(r.Context())
	jsonOK(w, map[string]string{"status": "reordered"})
}

// ─────────────────────────────────────────────────────────────
// Playback handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handlePlaybackState(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	state, err := rm.Playback.GetState(r.Context())
	if err != nil {
		jsonError(w, "state error", http.StatusInternalServerError)
		return
	}
	// Include active_player_session_id from the DB so clients can decide
	// whether to auto-claim or stay silent on first load.
	var activePlayerID *string
	_ = s.db.GetContext(r.Context(), &activePlayerID,
		`SELECT active_player_session_id FROM rooms WHERE id = ?`, rm.Info.ID)

	// Marshal state to a map, then inject active_player_session_id alongside it.
	// This avoids importing the playback package from the api package.
	stateBytes, _ := json.Marshal(state)
	var stateMap map[string]any
	_ = json.Unmarshal(stateBytes, &stateMap)
	stateMap["active_player_session_id"] = activePlayerID
	jsonOK(w, stateMap)
}

func (s *Server) handlePlay(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}

	var req struct {
		TrackID string `json:"track_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	rm := getRoomFromCtx(r.Context())
	if err := rm.Playback.Play(r.Context(), req.TrackID, userID); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonOK(w, map[string]string{"status": "playing"})
}

func (s *Server) handlePause(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	if err := rm.Playback.Pause(r.Context()); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "toggled"})
}

func (s *Server) handleSkip(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}
	rm := getRoomFromCtx(r.Context())
	if err := rm.Playback.Skip(r.Context(), userID, true); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.broadcastQueueChange(r.Context())
	jsonOK(w, map[string]string{"status": "skipped"})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	trackID := chi.URLParam(r, "trackId")

	var track db.Track
	if err := s.db.Get(&track, `SELECT * FROM tracks WHERE id = ?`, trackID); err != nil {
		jsonError(w, "track not found", http.StatusNotFound)
		return
	}

	if track.FilePath == "" {
		jsonError(w, "track has no local file", http.StatusBadRequest)
		return
	}

	// For YouTube tracks the file may still be downloading in the background.
	// Wait up to 5 minutes for it to appear before giving up.
	if track.SourceType == "youtube" {
		deadline := time.Now().Add(5 * time.Minute)
		for time.Now().Before(deadline) {
			if _, statErr := os.Stat(track.FilePath); statErr == nil {
				break
			}
			time.Sleep(2 * time.Second)
		}
		if _, statErr := os.Stat(track.FilePath); statErr != nil {
			jsonError(w, "track file not ready yet", http.StatusServiceUnavailable)
			return
		}
	}

	// Security: reject paths that escape allowed media directories.
	cleanTrack := filepath.Clean(track.FilePath)
	cleanMusic := filepath.Clean(s.cfg.MusicDir)
	cleanUploads := filepath.Clean(config.GlobalPartyUploadsDir(s.cfg.DBPath))
	cleanExternal := filepath.Clean(s.cfg.ExternalMusicDir)
	allowedMusic := strings.HasPrefix(cleanTrack, cleanMusic+string(filepath.Separator)) || cleanTrack == cleanMusic
	allowedUploads := strings.HasPrefix(cleanTrack, cleanUploads+string(filepath.Separator)) || cleanTrack == cleanUploads
	allowedExternal := s.cfg.ExternalMusicDir != "" && (strings.HasPrefix(cleanTrack, cleanExternal+string(filepath.Separator)) || cleanTrack == cleanExternal)
	if !allowedMusic && !allowedUploads && !allowedExternal {
		jsonError(w, "forbidden", http.StatusForbidden)
		return
	}

	// Check file exists before serving — self-heal by removing orphaned tracks.
	if _, statErr := os.Stat(track.FilePath); os.IsNotExist(statErr) {
		s.db.Exec(`DELETE FROM tracks WHERE id = ?`, trackID)
		log.Printf("[stream] track %s missing file %s — removed from library", trackID, track.FilePath)
		jsonError(w, "track file not found", http.StatusNotFound)
		return
	}

	// Determine content-type from file extension
	contentType := audioContentType(track.FilePath)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")
	// Required for Web Audio API (createMediaElementSource) to work when the
	// audio element is loaded cross-origin via a direct stream URL. Without this
	// the browser taints the audio data and the AudioContext outputs zeroes.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Range")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")

	http.ServeFile(w, r, track.FilePath)
}

func (s *Server) handlePlaybackHistory(w http.ResponseWriter, r *http.Request) {
	var history []db.PlaybackHistory
	_ = s.db.Select(&history, `
		SELECT * FROM playback_history
		ORDER BY started_at DESC LIMIT 50`)
	jsonOK(w, history)
}

func (s *Server) handleTrackEnded(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}
	var req struct {
		TrackID string `json:"track_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	rm := getRoomFromCtx(r.Context())
	_ = rm.Playback.TrackEnded(r.Context(), req.TrackID, userID)
	s.broadcastQueueChange(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdatePosition(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Position float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid", http.StatusBadRequest)
		return
	}
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}
	rm := getRoomFromCtx(r.Context())
	rm.Playback.UpdatePosition(r.Context(), req.Position, userID)
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────
// Phase 2: Active player session handlers
// ─────────────────────────────────────────────────────────────

// handleClaimPlayer lets a session claim the "active player" role for the room.
// Only one session can hold it at a time. Guests (is_guest_session=1) are blocked.
func (s *Server) handleClaimPlayer(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if sd.Session.IsGuestSession {
		jsonError(w, "guests cannot claim the player", http.StatusForbidden)
		return
	}

	rm := getRoomFromCtx(r.Context())
	sessionID := sd.Session.ID

	_, err := s.db.ExecContext(r.Context(),
		`UPDATE rooms SET active_player_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		sessionID, rm.Info.ID,
	)
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	// Keep the in-memory cache in sync so handleReleasePlayer's guard check is accurate.
	rm.Info.ActivePlayerSessionID = &sessionID

	s.hub.BroadcastToRoom(rm.Info.ID, "active_player_changed", map[string]any{
		"active_player_session_id": sessionID,
	})

	jsonOK(w, map[string]any{"active_player_session_id": sessionID})
}

// handleReleasePlayer releases the active player role for the room.
// Only the current active player or an admin may release it.
// If this session is not the active player, it's a no-op (200 OK).
func (s *Server) handleReleasePlayer(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	rm := getRoomFromCtx(r.Context())

	// If someone else holds the player and this isn't an admin, treat as no-op.
	if rm.Info.ActivePlayerSessionID != nil &&
		*rm.Info.ActivePlayerSessionID != sd.Session.ID &&
		sd.User.Role != "admin" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	_, err := s.db.ExecContext(r.Context(),
		`UPDATE rooms SET active_player_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		rm.Info.ID,
	)
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	// Keep the in-memory cache in sync.
	rm.Info.ActivePlayerSessionID = nil

	s.hub.BroadcastToRoom(rm.Info.ID, "active_player_changed", map[string]any{"active_player_session_id": nil})

	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────
// Phase 3: Audio state (volume, balance, tone, mute) handlers
// ─────────────────────────────────────────────────────────────

type audioStateRequest struct {
	Volume     *int  `json:"volume"`
	Balance    *int  `json:"balance"`
	ToneBass   *int  `json:"tone_bass"`
	ToneMid    *int  `json:"tone_mid"`
	ToneTreble *int  `json:"tone_treble"`
	IsMuted    *bool `json:"is_muted"`
	Loudness   *bool `json:"loudness"`
	// Auto DJ fields (migration 015)
	AutoDjEnabled         *bool `json:"auto_dj_enabled"`
	CrossfadeSeconds      *int  `json:"crossfade_seconds"`
	TempoMatchEnabled     *bool `json:"tempo_match_enabled"`
	MaxTempoAdjustPercent *int  `json:"max_tempo_adjust_percent"`
}

func (s *Server) handleGetAudioState(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	// Read directly from DB — the in-memory Room cache loads Info only once (on first
	// access) and does not update it when audio settings change via handleUpdateAudioState.
	// Reading from DB ensures Device B always sees the current values set by Device A.
	var info db.Room
	if err := s.db.GetContext(r.Context(), &info, `SELECT * FROM rooms WHERE id = ?`, rm.Info.ID); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{
		"volume":                   info.Volume,
		"balance":                  info.Balance,
		"tone_bass":                info.ToneBass,
		"tone_mid":                 info.ToneMid,
		"tone_treble":              info.ToneTreble,
		"is_muted":                 info.IsMuted,
		"loudness":                 info.Loudness,
		"auto_dj_enabled":          info.AutoDjEnabled,
		"crossfade_seconds":        info.CrossfadeSeconds,
		"tempo_match_enabled":      info.TempoMatchEnabled,
		"max_tempo_adjust_percent": info.MaxTempoAdjustPercent,
	})
}

func (s *Server) handleUpdateAudioState(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	if sd == nil {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if sd.Session.IsGuestSession {
		jsonError(w, "guests cannot change audio settings", http.StatusForbidden)
		return
	}

	var req audioStateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	rm := getRoomFromCtx(r.Context())

	// Build partial UPDATE using only supplied fields.
	sets := []string{"updated_at = CURRENT_TIMESTAMP"}
	args := []any{}

	if req.Volume != nil {
		v := *req.Volume
		if v < 0 {
			v = 0
		}
		if v > 100 {
			v = 100
		}
		sets = append(sets, "volume = ?")
		args = append(args, v)
	}
	if req.Balance != nil {
		b := *req.Balance
		if b < -100 {
			b = -100
		}
		if b > 100 {
			b = 100
		}
		sets = append(sets, "balance = ?")
		args = append(args, b)
	}
	if req.ToneBass != nil {
		sets = append(sets, "tone_bass = ?")
		args = append(args, clamp(*req.ToneBass, -12, 12))
	}
	if req.ToneMid != nil {
		sets = append(sets, "tone_mid = ?")
		args = append(args, clamp(*req.ToneMid, -12, 12))
	}
	if req.ToneTreble != nil {
		sets = append(sets, "tone_treble = ?")
		args = append(args, clamp(*req.ToneTreble, -12, 12))
	}
	if req.IsMuted != nil {
		sets = append(sets, "is_muted = ?")
		args = append(args, *req.IsMuted)
	}
	if req.Loudness != nil {
		sets = append(sets, "loudness = ?")
		args = append(args, *req.Loudness)
	}
	if req.AutoDjEnabled != nil {
		sets = append(sets, "auto_dj_enabled = ?")
		args = append(args, *req.AutoDjEnabled)
	}
	if req.CrossfadeSeconds != nil {
		sets = append(sets, "crossfade_seconds = ?")
		args = append(args, clamp(*req.CrossfadeSeconds, 2, 30))
	}
	if req.TempoMatchEnabled != nil {
		sets = append(sets, "tempo_match_enabled = ?")
		args = append(args, *req.TempoMatchEnabled)
	}
	if req.MaxTempoAdjustPercent != nil {
		sets = append(sets, "max_tempo_adjust_percent = ?")
		args = append(args, clamp(*req.MaxTempoAdjustPercent, 1, 20))
	}

	if len(sets) == 1 {
		// Nothing to update
		w.WriteHeader(http.StatusNoContent)
		return
	}

	query := "UPDATE rooms SET " + strings.Join(sets, ", ") + " WHERE id = ?"
	args = append(args, rm.Info.ID)
	if _, err := s.db.ExecContext(r.Context(), query, args...); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	// Re-read updated room to broadcast accurate values.
	var updated db.Room
	if err := s.db.GetContext(r.Context(), &updated, `SELECT * FROM rooms WHERE id = ?`, rm.Info.ID); err != nil {
		jsonError(w, "db read error", http.StatusInternalServerError)
		return
	}

	s.hub.BroadcastToRoom(rm.Info.ID, "audio_state_changed", map[string]any{
		"volume":                   updated.Volume,
		"balance":                  updated.Balance,
		"tone_bass":                updated.ToneBass,
		"tone_mid":                 updated.ToneMid,
		"tone_treble":              updated.ToneTreble,
		"is_muted":                 updated.IsMuted,
		"loudness":                 updated.Loudness,
		"auto_dj_enabled":          updated.AutoDjEnabled,
		"crossfade_seconds":        updated.CrossfadeSeconds,
		"tempo_match_enabled":      updated.TempoMatchEnabled,
		"max_tempo_adjust_percent": updated.MaxTempoAdjustPercent,
	})

	jsonOK(w, map[string]any{
		"volume":                   updated.Volume,
		"balance":                  updated.Balance,
		"tone_bass":                updated.ToneBass,
		"tone_mid":                 updated.ToneMid,
		"tone_treble":              updated.ToneTreble,
		"is_muted":                 updated.IsMuted,
		"loudness":                 updated.Loudness,
		"auto_dj_enabled":          updated.AutoDjEnabled,
		"crossfade_seconds":        updated.CrossfadeSeconds,
		"tempo_match_enabled":      updated.TempoMatchEnabled,
		"max_tempo_adjust_percent": updated.MaxTempoAdjustPercent,
	})
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// ─────────────────────────────────────────────────────────────
// Party handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleCheers(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}

	// SKÅL kun på den jukebox der hører til den bruger der trykkede knappen.
	// Bruger 1's SKÅL-knap rammer kun rum 1 — ikke rum 2, 3 eller 4.
	rm := getRoomFromCtx(r.Context())
	seq, err := rm.Party.BuildSequence(r.Context())
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	firstTrack := seq.Tracks[0]
	coverURL := ""
	if firstTrack.CoverArtID != nil && *firstTrack.CoverArtID != "" {
		coverURL = "/api/library/cover/" + *firstTrack.CoverArtID + "?size=large"
	}
	partyPayload := map[string]any{
		"track":        firstTrack,
		"cover_url":    coverURL,
		"triggered_by": userID,
		"volume_boost": seq.VolumeBoost,
		"track_count":  len(seq.Tracks),
	}

	if err := rm.Playback.StartParty(r.Context(), seq.Tracks, userID); err != nil {
		log.Printf("[party] StartParty error: %v", err)
	}
	s.hub.BroadcastToRoom(rm.Info.ID, events.EventPartyStarted, partyPayload)

	jsonOK(w, map[string]any{
		"track":        firstTrack,
		"status":       "party started",
		"track_count":  len(seq.Tracks),
		"volume_boost": seq.VolumeBoost,
	})
}

func (s *Server) handlePartyEnd(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}
	rm := getRoomFromCtx(r.Context())
	_ = rm.Playback.ForceEndParty(r.Context(), userID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePartyState(w http.ResponseWriter, r *http.Request) {
	rm := getRoomFromCtx(r.Context())
	state, _ := rm.Playback.GetState(r.Context())
	jsonOK(w, map[string]any{
		"is_party_mode":  state != nil && state.IsPartyMode,
		"party_track_id": "",
	})
}

// ─────────────────────────────────────────────────────────────
// Room middleware + helpers
// ─────────────────────────────────────────────────────────────

// roomMiddleware attaches the user's personal room to the request context.
// For normal users: room_id = user_id (each user has their own jukebox)
// For admins: can override with X-Room-ID header to view/control other users' jukeboxes
func (s *Server) roomMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sd, _ := auth.GetSessionFromContext(r.Context())

		var roomID string

		// Admin can override with X-Room-ID header to view any user's jukebox
		if sd != nil && sd.User.Role == "admin" {
			if headerRoomID := r.Header.Get("X-Room-ID"); headerRoomID != "" {
				roomID = headerRoomID
			}
		}

		// Default: use authenticated user's ID as their room ID
		if roomID == "" && sd != nil {
			roomID = sd.User.ID
		}

		// Fallback to "default" room if no user session (shouldn't happen for protected routes)
		if roomID == "" {
			roomID = "default"
		}

		room := s.roomSvc.Get(r.Context(), roomID)
		if room == nil {
			// Auto-create room for user if it doesn't exist
			if sd != nil && roomID == sd.User.ID {
				room = s.roomSvc.CreateForUser(r.Context(), sd.User.ID, sd.User.DisplayName)
			} else {
				room = s.roomSvc.Get(r.Context(), "default")
			}
		}

		ctx := context.WithValue(r.Context(), roomContextKey, room)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func getRoomFromCtx(ctx context.Context) *rooms.Room {
	if r, ok := ctx.Value(roomContextKey).(*rooms.Room); ok {
		return r
	}
	return nil
}

// ─────────────────────────────────────────────────────────────
// Setup handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok", "version": s.version})
}

func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	var adminCount int
	_ = s.db.Get(&adminCount, `SELECT COUNT(*) FROM users WHERE role = 'admin'`)
	jsonOK(w, map[string]bool{"needs_setup": adminCount == 0})
}

func (s *Server) handleSetupComplete(w http.ResponseWriter, r *http.Request) {
	// Only allowed when no admin account exists yet.
	var adminCount int
	_ = s.db.Get(&adminCount, `SELECT COUNT(*) FROM users WHERE role = 'admin'`)
	if adminCount > 0 {
		jsonError(w, "setup already completed", http.StatusForbidden)
		return
	}

	var req struct {
		AdminUsername string `json:"admin_username"`
		AdminPassword string `json:"admin_password"`
		SMTP          *struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Username string `json:"username"`
			Password string `json:"password"`
			From     string `json:"from"`
			FromName string `json:"from_name"`
		} `json:"smtp,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.AdminUsername = strings.TrimSpace(req.AdminUsername)
	if req.AdminUsername == "" || len(req.AdminPassword) < 6 {
		jsonError(w, "username og adgangskode (min. 6 tegn) kræves", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, "hash error", http.StatusInternalServerError)
		return
	}

	// Use a transaction: clear any stale admin then insert fresh.
	tx, err := s.db.Beginx()
	if err != nil {
		jsonError(w, "db tx error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint

	// Remove any stale admin rows (shouldn't exist, but be safe).
	if _, err := tx.Exec(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE role='admin')`); err != nil {
		log.Printf("[setup] clean admin permissions: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin')`); err != nil {
		log.Printf("[setup] clean admin sessions: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`DELETE FROM users WHERE role='admin'`); err != nil {
		log.Printf("[setup] clean admin user: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	adminID := uuid.NewString()
	if _, err := tx.Exec(`
		INSERT INTO users (id, username, display_name, pin_hash, role, is_permanent, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'admin', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		adminID, req.AdminUsername, req.AdminUsername, string(hash)); err != nil {
		log.Printf("[setup] create admin user: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}
	log.Printf("[setup] admin user created: %q id=%s", req.AdminUsername, adminID)

	if _, err := tx.Exec(`
		INSERT INTO user_permissions (user_id, can_add_to_queue, can_search, can_use_party_button, can_view_queue)
		VALUES (?, 1, 1, 1, 1)`, adminID); err != nil {
		log.Printf("[setup] admin permissions: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[setup] commit: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Save SMTP settings if provided
	if req.SMTP != nil && req.SMTP.Host != "" {
		port := req.SMTP.Port
		if port == 0 {
			port = 587
		}
		fromName := req.SMTP.FromName
		if fromName == "" {
			fromName = "CrownJukebox"
		}
		smtpUpdates := map[string]string{
			"smtp_enabled":   "1",
			"smtp_host":      req.SMTP.Host,
			"smtp_port":      fmt.Sprintf("%d", port),
			"smtp_username":  req.SMTP.Username,
			"smtp_password":  req.SMTP.Password,
			"smtp_from":      req.SMTP.From,
			"smtp_from_name": fromName,
		}
		for k, v := range smtpUpdates {
			_, _ = s.db.Exec(`UPDATE settings SET value = ? WHERE key = ?`, v, k)
		}
	}

	_, _ = s.db.Exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_completed', '1')`)
	jsonOK(w, map[string]string{"status": "setup complete"})
}

// ─────────────────────────────────────────────────────────────
// Room handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleListRooms(w http.ResponseWriter, r *http.Request) {
	list, err := s.roomSvc.List(r.Context())
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, list)
}

func (s *Server) handleAdminCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		jsonError(w, "name required", http.StatusBadRequest)
		return
	}
	room, err := s.roomSvc.Create(r.Context(), req.Name)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, room)
}

func (s *Server) handleAdminDeleteRoom(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "default" {
		jsonError(w, "cannot delete default room", http.StatusBadRequest)
		return
	}
	if err := s.roomSvc.Delete(r.Context(), id); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminSetRoomPartyPlaylist(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	var req struct {
		PlaylistID string `json:"playlist_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := s.roomSvc.SetPartyPlaylist(r.Context(), roomID, req.PlaylistID); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "updated"})
}

// ─────────────────────────────────────────────────────────────
// SSE handler
// ─────────────────────────────────────────────────────────────

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}
	// room_id from query param (EventSource doesn't support custom headers)
	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		if rm := getRoomFromCtx(r.Context()); rm != nil {
			roomID = rm.Info.ID
		} else {
			roomID = "default"
		}
	}
	s.hub.ServeSSE(userID, roomID)(w, r)
}

// ─────────────────────────────────────────────────────────────
// Admin handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	var users []db.User
	_ = s.db.Select(&users, `SELECT * FROM users ORDER BY created_at DESC`)
	// Never return hashes
	jsonOK(w, sanitizeUsers(users))
}

// handleAdminListJukeboxes returns all user jukeboxes with their current playback status.
func (s *Server) handleAdminListJukeboxes(w http.ResponseWriter, r *http.Request) {
	// Get all users
	var users []db.User
	if err := s.db.Select(&users, `SELECT * FROM users ORDER BY display_name ASC`); err != nil {
		jsonError(w, "failed to fetch users", http.StatusInternalServerError)
		return
	}

	type SessionInfo struct {
		ID             string    `json:"id"`
		DeviceName     string    `json:"device_name"`
		IsGuestSession bool      `json:"is_guest_session"`
		CreatedAt      time.Time `json:"created_at"`
		LastSeenAt     time.Time `json:"last_seen_at"`
		IsActivePlayer bool      `json:"is_active_player"`
	}

	type JukeboxStatus struct {
		UserID       string `json:"user_id"`
		DisplayName  string `json:"display_name"`
		RoomID       string `json:"room_id"`
		IsPlaying    bool   `json:"is_playing"`
		IsPartyMode  bool   `json:"is_party_mode"`
		CurrentTrack *struct {
			ID     string `json:"id"`
			Title  string `json:"title"`
			Artist string `json:"artist"`
		} `json:"current_track,omitempty"`
		QueueLength           int           `json:"queue_length"`
		ActiveSessions        []SessionInfo `json:"active_sessions"`
		ActivePlayerSessionID *string       `json:"active_player_session_id"`
	}

	result := make([]JukeboxStatus, 0, len(users))

	for _, user := range users {
		status := JukeboxStatus{
			UserID:         user.ID,
			DisplayName:    user.DisplayName,
			RoomID:         user.ID, // room_id = user_id
			ActiveSessions: []SessionInfo{},
		}

		// Get playback state + active_player_session_id for user's room
		room := s.roomSvc.Get(r.Context(), user.ID)
		if room != nil {
			state, _ := room.Playback.GetState(r.Context())
			if state != nil {
				status.IsPlaying = state.IsPlaying
				status.IsPartyMode = state.IsPartyMode

				if state.CurrentTrack != nil {
					status.CurrentTrack = &struct {
						ID     string `json:"id"`
						Title  string `json:"title"`
						Artist string `json:"artist"`
					}{
						ID:     state.CurrentTrack.ID,
						Title:  state.CurrentTrack.Title,
						Artist: state.CurrentTrack.Artist,
					}
				}
			}

			// Get queue length
			queue, _ := room.Queue.GetQueue(r.Context())
			status.QueueLength = len(queue)

			// Read current active_player_session_id from DB (always fresh)
			var activeID *string
			_ = s.db.GetContext(r.Context(), &activeID,
				`SELECT active_player_session_id FROM rooms WHERE id = ?`, user.ID)
			status.ActivePlayerSessionID = activeID
		}

		// Fetch active (non-revoked, non-expired) sessions for this user
		var sessions []struct {
			ID             string    `db:"id"`
			DeviceName     string    `db:"device_name"`
			IsGuestSession bool      `db:"is_guest_session"`
			CreatedAt      time.Time `db:"created_at"`
			LastSeenAt     time.Time `db:"last_seen_at"`
		}
		_ = s.db.SelectContext(r.Context(), &sessions, `
			SELECT id, device_name, is_guest_session, created_at, last_seen_at
			FROM sessions
			WHERE user_id = ?
			  AND revoked_at IS NULL
			  AND expires_at > CURRENT_TIMESTAMP
			ORDER BY last_seen_at DESC`, user.ID)

		for _, sess := range sessions {
			isActive := status.ActivePlayerSessionID != nil && *status.ActivePlayerSessionID == sess.ID
			status.ActiveSessions = append(status.ActiveSessions, SessionInfo{
				ID:             sess.ID,
				DeviceName:     sess.DeviceName,
				IsGuestSession: sess.IsGuestSession,
				CreatedAt:      sess.CreatedAt,
				LastSeenAt:     sess.LastSeenAt,
				IsActivePlayer: isActive,
			})
		}

		result = append(result, status)
	}

	jsonOK(w, result)
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DisplayName     string `json:"display_name"`
		Email           string `json:"email"`
		Username        string `json:"username"`
		Role            string `json:"role"`
		Pin             string `json:"pin"`
		IsPermanent     bool   `json:"is_permanent"`
		AccessExpiresAt string `json:"access_expires_at"`
		CanAddToQueue   bool   `json:"can_add_to_queue"`
		CanSearch       bool   `json:"can_search"`
		CanUseParty     bool   `json:"can_use_party_button"`
		CanViewQueue    bool   `json:"can_view_queue"`
		SendInvite      bool   `json:"send_invite"`
		BaseURL         string `json:"base_url"` // window.location.origin from browser
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.DisplayName == "" {
		jsonError(w, "display_name required", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Username == "" {
		req.Username = req.Email
	}

	pinHash := ""
	if req.Pin != "" {
		h, err := auth.HashPassword(req.Pin)
		if err != nil {
			jsonError(w, "hash error", http.StatusInternalServerError)
			return
		}
		pinHash = h
	}

	sd, _ := auth.GetSessionFromContext(r.Context())
	var createdByAdminID *string
	if sd != nil {
		adminID := sd.User.ID
		createdByAdminID = &adminID
	}

	user := db.User{
		ID:               uuid.NewString(),
		DisplayName:      req.DisplayName,
		Email:            req.Email,
		Username:         req.Username,
		Role:             req.Role,
		PinHash:          pinHash,
		IsActive:         true,
		IsPermanent:      req.IsPermanent,
		CreatedByAdminID: createdByAdminID,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	if !req.IsPermanent && req.AccessExpiresAt != "" {
		t, err := time.Parse(time.RFC3339Nano, req.AccessExpiresAt)
		if err != nil {
			t, err = time.Parse(time.RFC3339, req.AccessExpiresAt)
		}
		if err == nil {
			user.AccessExpiresAt = &t
		}
	}

	tx, _ := s.db.BeginTxx(r.Context(), nil)
	defer tx.Rollback()

	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO users (id, display_name, email, username, role, pin_hash, is_active, is_permanent,
		                   access_expires_at, created_by_admin_id, force_pin_change, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.DisplayName, user.Email, user.Username, user.Role, user.PinHash,
		user.IsActive, user.IsPermanent, user.AccessExpiresAt, user.CreatedByAdminID,
		req.Pin != "", // force_pin_change when a PIN was set by admin
		user.CreatedAt, user.UpdatedAt,
	); err != nil {
		jsonError(w, "create user failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO user_permissions (user_id, can_add_to_queue, can_search, can_use_party_button, can_view_queue)
		VALUES (?, ?, ?, ?, ?)`,
		user.ID, req.CanAddToQueue, req.CanSearch, req.CanUseParty, req.CanViewQueue,
	); err != nil {
		jsonError(w, "create permissions failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		jsonError(w, "commit failed", http.StatusInternalServerError)
		return
	}

	// Send invitation email if email provided and send_invite is true
	inviteSent := false
	inviteErr := ""
	if req.SendInvite && req.Email != "" {
		baseURL := s.resolveBaseURL(r.Context(), req.BaseURL)
		var expiry *time.Time
		var expDur time.Duration
		if user.AccessExpiresAt != nil {
			expDur = time.Until(*user.AccessExpiresAt)
			expiry = user.AccessExpiresAt
		} else {
			expDur = 14 * 24 * time.Hour
			t := time.Now().Add(expDur)
			expiry = &t
		}

		_, token, err := s.qrSvc.CreateAccessLink(r.Context(), user.ID, expDur)
		if err == nil {
			accessURL := baseURL + "/qr/" + token
			if err := s.emailSvc.SendInvitation(r.Context(), req.Email, user.DisplayName, user.Username, req.Pin, accessURL, expiry); err != nil {
				inviteErr = err.Error()
				log.Printf("[invite] failed to send invitation to %s: %v", req.Email, err)
			} else {
				inviteSent = true
			}
		} else {
			inviteErr = err.Error()
		}
	}

	type createUserResponse struct {
		User       interface{} `json:"user"`
		InviteSent bool        `json:"invite_sent"`
		InviteErr  string      `json:"invite_error,omitempty"`
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, createUserResponse{User: userResponse(user), InviteSent: inviteSent, InviteErr: inviteErr})
}

func (s *Server) handleAdminGetUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var user db.User
	if err := s.db.Get(&user, `SELECT * FROM users WHERE id = ?`, id); err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}
	jsonOK(w, userResponse(user))
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		DisplayName *string `json:"display_name"`
		IsActive    *bool   `json:"is_active"`
		IsPermanent *bool   `json:"is_permanent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	// Build dynamic update (simplified)
	if req.DisplayName != nil {
		s.db.Exec(`UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, *req.DisplayName, id)
	}
	if req.IsActive != nil {
		s.db.Exec(`UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, *req.IsActive, id)
	}
	jsonOK(w, map[string]string{"status": "updated"})
}

func (s *Server) handleAdminDisableUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s.db.Exec(`UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id)

	// Revoke all sessions
	_ = s.authSvc.RevokeAllUserSessions(r.Context(), id)

	// Broadcast access revoked
	s.hub.BroadcastToUser(id, events.EventUserAccessRevoked, map[string]any{"user_id": id})

	jsonOK(w, map[string]string{"status": "disabled"})
}

func (s *Server) handleAdminEnableUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s.db.Exec(`UPDATE users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	jsonOK(w, map[string]string{"status": "enabled"})
}

func (s *Server) handleAdminExtendUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		DurationMinutes int `json:"duration_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DurationMinutes <= 0 {
		jsonError(w, "duration_minutes required", http.StatusBadRequest)
		return
	}

	// Extend from current expiry or from now
	var user db.User
	if err := s.db.Get(&user, `SELECT * FROM users WHERE id = ?`, id); err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}

	base := time.Now()
	if user.AccessExpiresAt != nil && user.AccessExpiresAt.After(base) {
		base = *user.AccessExpiresAt
	}
	newExpiry := base.Add(time.Duration(req.DurationMinutes) * time.Minute)

	s.db.Exec(`UPDATE users SET access_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		newExpiry, id)

	jsonOK(w, map[string]any{"new_expires_at": newExpiry})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_ = s.authSvc.RevokeAllUserSessions(r.Context(), id)

	// NULL out FK references that lack ON DELETE CASCADE before deleting the user.
	// rooms.owner_user_id, queue_items.added_by_user_id, playback_history.played_by_user_id
	// and users.created_by_admin_id all reference users(id) without CASCADE.
	s.db.ExecContext(r.Context(), `UPDATE queue_items SET added_by_user_id = NULL WHERE added_by_user_id = ?`, id)
	s.db.ExecContext(r.Context(), `UPDATE playback_history SET played_by_user_id = NULL WHERE played_by_user_id = ?`, id)
	s.db.ExecContext(r.Context(), `UPDATE users SET created_by_admin_id = NULL WHERE created_by_admin_id = ?`, id)
	// Delete the user's personal room (room_playback_state cascades from rooms ON DELETE CASCADE)
	s.db.ExecContext(r.Context(), `DELETE FROM rooms WHERE owner_user_id = ?`, id)

	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM users WHERE id = ?`, id); err != nil {
		jsonError(w, "delete failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleAdminChangePassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.NewPassword == "" {
		jsonError(w, "new_password required", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 4 {
		jsonError(w, "password must be at least 4 characters", http.StatusBadRequest)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, "failed to hash password", http.StatusInternalServerError)
		return
	}
	if _, err := s.db.Exec(`UPDATE users SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, string(hash), id); err != nil {
		jsonError(w, "failed to update password", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleAdminInviteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Email            string `json:"email"`
		ExpiresInMinutes int    `json:"expires_in_minutes"`
		BaseURL          string `json:"base_url"` // window.location.origin from browser
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		jsonError(w, "email required", http.StatusBadRequest)
		return
	}

	// Build an access link for the user
	var expiry *time.Time
	expMins := req.ExpiresInMinutes
	if expMins == 0 {
		expMins = 14 * 24 * 60 // default 14 days
	}
	expDur := time.Duration(expMins) * time.Minute
	if expMins > 0 {
		t := time.Now().Add(expDur)
		expiry = &t
	}

	link, token, err := s.qrSvc.CreateAccessLink(r.Context(), id, expDur)
	if err != nil {
		jsonError(w, "failed to create access link: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = link // link.ID etc. available if needed

	// Get user display name
	var user db.User
	_ = s.db.GetContext(r.Context(), &user, `SELECT * FROM users WHERE id = ?`, id)

	accessURL := s.resolveBaseURL(r.Context(), req.BaseURL) + "/qr/" + token

	if err := s.emailSvc.SendInvitation(r.Context(), req.Email, user.DisplayName, user.Username, "", accessURL, expiry); err != nil {
		jsonError(w, "failed to send email: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Save email on user record
	_, _ = s.db.ExecContext(r.Context(), `UPDATE users SET email = ? WHERE id = ?`, req.Email, id)

	jsonOK(w, map[string]string{"status": "invitation sent"})
}

// ─────────────────────────────────────────────────────────────
// Access links / QR handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleAdminCreateAccessLink(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID           string `json:"user_id"`
		ExpiresInMinutes int    `json:"expires_in_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
		jsonError(w, "user_id required", http.StatusBadRequest)
		return
	}

	duration := time.Duration(req.ExpiresInMinutes) * time.Minute
	link, loginURL, err := s.qrSvc.CreateAccessLink(r.Context(), req.UserID, duration)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"id":         link.ID,
		"login_url":  loginURL,
		"expires_at": link.ExpiresAt,
	})
}

func (s *Server) handleAdminListAccessLinks(w http.ResponseWriter, r *http.Request) {
	var links []db.AccessLink
	_ = s.db.Select(&links, `
		SELECT id, user_id, created_at, expires_at, used_at, revoked_at
		FROM access_links ORDER BY created_at DESC`)
	jsonOK(w, links)
}

func (s *Server) handleAdminRevokeAccessLink(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_ = s.qrSvc.RevokeAccessLink(r.Context(), id)
	jsonOK(w, map[string]string{"status": "revoked"})
}

func (s *Server) handleAdminAccessLinkQR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Look up the existing link to get user_id
	var link db.AccessLink
	if err := s.db.Get(&link, `SELECT * FROM access_links WHERE id = ?`, id); err != nil {
		jsonError(w, "link not found", http.StatusNotFound)
		return
	}

	// Generate a fresh single-use link for this user (valid 8 hours) for the QR
	_, loginURL, err := s.qrSvc.CreateAccessLink(r.Context(), link.UserID, 8*time.Hour)
	if err != nil {
		jsonError(w, "could not create login link", http.StatusInternalServerError)
		return
	}

	png, err := auth.GenerateQRPNG(loginURL, 256)
	if err != nil {
		jsonError(w, "qr generation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Disposition", `inline; filename="qr.png"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(png)
}

// ─────────────────────────────────────────────────────────────
// Session admin handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleAdminListSessions(w http.ResponseWriter, r *http.Request) {
	var sessions []db.Session
	_ = s.db.Select(&sessions, `
		SELECT id, user_id, device_name, ip_address, created_at, expires_at, revoked_at, last_seen_at
		FROM sessions ORDER BY created_at DESC LIMIT 100`)
	jsonOK(w, sessions)
}

func (s *Server) handleAdminRevokeSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Look up the session's owner before revoking so we can handle playback consequences.
	var userID string
	_ = s.db.GetContext(r.Context(), &userID,
		`SELECT user_id FROM sessions WHERE id = ? AND revoked_at IS NULL`, id)

	_ = s.authSvc.RevokeSession(r.Context(), id)

	// Post-revoke: enforce playback consequences for the room owner.
	if userID != "" {
		rm := s.roomSvc.Get(r.Context(), userID)
		if rm != nil {
			// If the revoked session was the active player, clear that role immediately.
			wasActivePlayer := rm.Info.ActivePlayerSessionID != nil && *rm.Info.ActivePlayerSessionID == id
			if wasActivePlayer {
				_, _ = s.db.ExecContext(r.Context(),
					`UPDATE rooms SET active_player_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
					rm.Info.ID,
				)
				rm.Info.ActivePlayerSessionID = nil
				s.hub.BroadcastToRoom(rm.Info.ID, "active_player_changed",
					map[string]any{"active_player_session_id": nil})
			}

			// If there are no remaining non-guest, non-revoked, non-expired sessions
			// for this user, pause playback — nobody is around to own it.
			var remaining int
			_ = s.db.GetContext(r.Context(), &remaining, `
				SELECT COUNT(*) FROM sessions
				WHERE user_id = ?
				  AND is_guest_session = 0
				  AND revoked_at IS NULL
				  AND expires_at > CURRENT_TIMESTAMP`, userID)

			if remaining == 0 {
				_ = rm.Playback.Pause(r.Context())
			}
		}
	}

	jsonOK(w, map[string]string{"status": "revoked"})
}

// ─────────────────────────────────────────────────────────────
// Settings handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	var settings []db.Setting
	_ = s.db.Select(&settings, `SELECT * FROM settings ORDER BY key`)
	result := make(map[string]string)
	for _, st := range settings {
		result[st.Key] = st.Value
	}
	jsonOK(w, result)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	for k, v := range req {
		s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, k, v)
	}
	s.hub.Broadcast(events.EventSettingsChanged, req)
	jsonOK(w, map[string]string{"status": "updated"})
}

func (s *Server) handleRescan(w http.ResponseWriter, r *http.Request) {
	s.scanMu.Lock()
	s.libraryScan = &libraryScanInfo{}
	s.scanMu.Unlock()

	progress := make(chan music.ScanProgress, 10)
	go func() {
		if err := s.scanner.Scan(progress); err != nil {
			log.Printf("[rescan] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done || p.Error != "" {
				s.libraryScan = nil
			} else {
				s.libraryScan = &libraryScanInfo{Total: p.Total, Scanned: p.Scanned, CurrentFile: p.CurrentFile}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast(events.EventLibraryScanProgress, p)
			// After library scan completes, automatically find artwork for new albums.
			if p.Done {
				go s.startMissingArtworkScan()
			}
		}
	}()
	jsonOK(w, map[string]string{"status": "scan started"})
}

// TriggerBackgroundScan starts a library scan in the background if one isn't
// already running. Returns true if a new scan was started, false if skipped.
// Safe to call from any goroutine (e.g. the periodic auto-scan ticker).
func (s *Server) TriggerBackgroundScan() bool {
	s.scanMu.Lock()
	if s.libraryScan != nil {
		s.scanMu.Unlock()
		return false // already running
	}
	s.libraryScan = &libraryScanInfo{}
	s.scanMu.Unlock()

	progress := make(chan music.ScanProgress, 10)
	go func() {
		if err := s.scanner.Scan(progress); err != nil {
			log.Printf("[autoscan] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done || p.Error != "" {
				s.libraryScan = nil
			} else {
				s.libraryScan = &libraryScanInfo{Total: p.Total, Scanned: p.Scanned, CurrentFile: p.CurrentFile}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast(events.EventLibraryScanProgress, p)
			if p.Done {
				go s.startMissingArtworkScan()
			}
		}
	}()
	return true
}

// startMissingArtworkScan finds and caches cover art for albums that currently
// have no artwork. Safe to call concurrently — skips if a scan is already running.
func (s *Server) startMissingArtworkScan() {
	s.scanMu.Lock()
	if s.artworkScan != nil {
		s.scanMu.Unlock()
		return
	}
	s.artworkScan = &artworkScanInfo{}
	s.scanMu.Unlock()

	progress := make(chan artwork.ExtractProgress, 10)
	go func() {
		if err := s.artExt.ExtractMissing(progress); err != nil {
			log.Printf("[auto-artwork] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done {
				s.artworkScan = nil
			} else {
				s.artworkScan = &artworkScanInfo{Total: p.Total, Processed: p.Processed}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast(events.EventArtworkScanProgress, p)
			if p.AlbumID != "" {
				s.hub.Broadcast(events.EventArtworkUpdated, map[string]any{"album_id": p.AlbumID})
			}
		}
	}()
}

// handleListBrokenFiles returns local tracks whose duration is 0 (unreadable or
// untagged files that the scanner could not extract timing information from).
// Tracks in the SKÅL uploads directory are always excluded — they have their own panel.
func (s *Server) handleListBrokenFiles(w http.ResponseWriter, r *http.Request) {
	uploadsDir := config.GlobalPartyUploadsDir(s.cfg.DBPath)
	if !strings.HasSuffix(uploadsDir, "/") {
		uploadsDir += "/"
	}
	var tracks []db.Track
	err := s.db.Select(&tracks, `
		SELECT
			t.id, t.album_id, t.artist_id, t.title,
			t.track_number, t.disc_number, t.duration, t.bpm,
			t.file_path, t.source_type, t.source_id, t.stream_url,
			t.created_at, t.updated_at,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.source_type = 'local' AND t.duration = 0
		  AND t.file_path NOT LIKE ?
		ORDER BY t.file_path ASC
		LIMIT 1000`, uploadsDir+"%")
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	if tracks == nil {
		tracks = []db.Track{}
	}
	jsonOK(w, tracks)
}

// handleRepairBrokenFiles re-reads duration for all tracks with duration=0
// using the updated parser (including ffprobe fallback). Updates the database
// in-place so no full rescan is needed.
func (s *Server) handleRepairBrokenFiles(w http.ResponseWriter, r *http.Request) {
	uploadsDir := config.GlobalPartyUploadsDir(s.cfg.DBPath)
	if !strings.HasSuffix(uploadsDir, "/") {
		uploadsDir += "/"
	}
	type row struct {
		ID       string `db:"id"`
		FilePath string `db:"file_path"`
	}
	var broken []row
	if err := s.db.Select(&broken, `
		SELECT id, file_path FROM tracks
		WHERE source_type = 'local' AND duration = 0
		  AND file_path NOT LIKE ?`, uploadsDir+"%"); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	repaired := 0
	for _, t := range broken {
		d := music.GetDurationSecs(t.FilePath)
		if d <= 0 {
			continue
		}
		// Update duration and grab BPM in the same pass — avoids a separate
		// BPM scan step for files that were only broken due to totalSamples=0.
		bpm := music.ComputeBPM(t.FilePath)
		if _, err := s.db.Exec(
			`UPDATE tracks SET duration = ?, bpm = CASE WHEN bpm = 0 THEN ? ELSE bpm END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			d, bpm, t.ID,
		); err != nil {
			log.Printf("[repair] update %s: %v", t.ID, err)
			continue
		}
		repaired++
	}
	jsonOK(w, map[string]int{"repaired": repaired, "total": len(broken)})
}

// handleDeleteTrack removes a local or SKÅL-upload track from the database (not from disk).
// Clears all FK references first so SQLite FK constraints are not violated.
func (s *Server) handleDeleteTrack(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var track db.Track
	if err := s.db.Get(&track, `SELECT * FROM tracks WHERE id = ? AND source_type IN ('local','party_upload')`, id); err != nil {
		jsonError(w, "track ikke fundet", http.StatusNotFound)
		return
	}
	albumID := track.AlbumID
	artistID := track.ArtistID

	// Clear all FK references before deleting the track row
	s.db.Exec(`DELETE FROM playlist_tracks WHERE track_id = ?`, id)
	s.db.Exec(`DELETE FROM queue_items WHERE track_id = ?`, id)
	s.db.Exec(`DELETE FROM playback_history WHERE track_id = ?`, id)
	s.db.Exec(`UPDATE playback_state SET current_track_id = NULL WHERE current_track_id = ?`, id)
	s.db.Exec(`UPDATE playback_state SET party_track_id = NULL WHERE party_track_id = ?`, id)
	s.db.Exec(`DELETE FROM tracks WHERE id = ?`, id)
	// Remove album if now empty
	s.db.Exec(`DELETE FROM albums WHERE id = ? AND (SELECT COUNT(*) FROM tracks WHERE album_id = ?) = 0`, albumID, albumID)
	// Remove artist if now empty
	s.db.Exec(`DELETE FROM artists WHERE id = ? AND (SELECT COUNT(*) FROM tracks WHERE artist_id = ?) = 0`, artistID, artistID)

	log.Printf("[delete-track] removed track %s (%s)", id, track.FilePath)
	jsonOK(w, map[string]string{"status": "deleted"})
}

// handleResetLibrary wipes all auto-scanned tracks, albums, orphan artists and
// folder-based playlists so that the next scan starts from a completely clean slate.
// Manual playlists (SKÅL!, source_type='local') are preserved.
func (s *Server) handleResetLibrary(w http.ResponseWriter, r *http.Request) {
	// Refuse if a scan is already running
	s.scanMu.RLock()
	scanning := s.libraryScan != nil
	s.scanMu.RUnlock()
	if scanning {
		jsonError(w, "scanning er i gang — vent til den er færdig", http.StatusConflict)
		return
	}

	tx, err := s.db.Beginx()
	if err != nil {
		jsonError(w, "db fejl", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint:errcheck

	// 1. Delete folder-generated playlists (and their tracks via CASCADE)
	if _, err := tx.Exec(`DELETE FROM playlists WHERE source_type = 'folder'`); err != nil {
		jsonError(w, "kunne ikke slette mappe-playlister", http.StatusInternalServerError)
		return
	}

	// 2. Clear FK references that point at local/subsonic tracks
	if _, err := tx.Exec(`
		DELETE FROM queue_items
		WHERE track_id IN (SELECT id FROM tracks WHERE source_type IN ('local','subsonic'))`); err != nil {
		jsonError(w, "kunne ikke rydde kø", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		DELETE FROM playback_history
		WHERE track_id IN (SELECT id FROM tracks WHERE source_type IN ('local','subsonic'))`); err != nil {
		jsonError(w, "kunne ikke rydde historik", http.StatusInternalServerError)
		return
	}
	tx.Exec(`UPDATE playback_state SET current_track_id = NULL
		WHERE current_track_id IN (SELECT id FROM tracks WHERE source_type IN ('local','subsonic'))`)
	tx.Exec(`UPDATE playback_state SET party_track_id = NULL
		WHERE party_track_id IN (SELECT id FROM tracks WHERE source_type IN ('local','subsonic'))`)

	// 3. Remove all local/subsonic tracks from manual playlists
	if _, err := tx.Exec(`
		DELETE FROM playlist_tracks
		WHERE track_id IN (
			SELECT id FROM tracks WHERE source_type IN ('local','subsonic')
		)`); err != nil {
		jsonError(w, "kunne ikke rydde playlist_tracks", http.StatusInternalServerError)
		return
	}

	// 4. Delete all local/subsonic tracks
	if _, err := tx.Exec(`DELETE FROM tracks WHERE source_type IN ('local','subsonic')`); err != nil {
		jsonError(w, "kunne ikke slette numre", http.StatusInternalServerError)
		return
	}

	// 5. Delete albums that have no remaining tracks
	if _, err := tx.Exec(`
		DELETE FROM albums
		WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)`); err != nil {
		jsonError(w, "kunne ikke slette albums", http.StatusInternalServerError)
		return
	}

	// 6. Delete artists that have no remaining tracks
	if _, err := tx.Exec(`
		DELETE FROM artists
		WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)`); err != nil {
		jsonError(w, "kunne ikke slette kunstnere", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		jsonError(w, "commit fejl", http.StatusInternalServerError)
		return
	}

	log.Printf("[reset-library] bibliotek nulstillet af admin")
	jsonOK(w, map[string]string{"status": "ok", "message": "Bibliotek nulstillet — klar til ny scanning"})
}

func (s *Server) handleRescanArtwork(w http.ResponseWriter, r *http.Request) {
	s.scanMu.Lock()
	s.artworkScan = &artworkScanInfo{}
	s.scanMu.Unlock()

	progress := make(chan artwork.ExtractProgress, 10)
	go func() {
		if err := s.artExt.ExtractAll(progress); err != nil {
			log.Printf("[rescan-artwork] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done {
				s.artworkScan = nil
			} else {
				s.artworkScan = &artworkScanInfo{Total: p.Total, Processed: p.Processed}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast(events.EventArtworkScanProgress, p)
			if p.AlbumID != "" {
				s.hub.Broadcast(events.EventArtworkUpdated, map[string]any{"album_id": p.AlbumID})
			}
		}
	}()
	jsonOK(w, map[string]string{"status": "artwork scan started"})
}

func (s *Server) handleRescanMissingArtwork(w http.ResponseWriter, r *http.Request) {
	progress := make(chan artwork.ExtractProgress, 10)
	go func() {
		if err := s.artExt.ExtractMissing(progress); err != nil {
			log.Printf("[rescan-missing-artwork] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.hub.Broadcast(events.EventArtworkScanProgress, p)
		}
	}()
	jsonOK(w, map[string]string{"status": "missing artwork scan started"})
}

func (s *Server) handleAdminMissingArtwork(w http.ResponseWriter, r *http.Request) {
	s.handleMissingCovers(w, r)
}

// handleAnalyzeBPM starts a background job that computes BPM for every local
// track that currently has bpm = 0. Results are written back to the database
// and broadcast via SSE (event: bpm_scan_progress).
func (s *Server) handleAnalyzeBPM(w http.ResponseWriter, r *http.Request) {
	s.scanMu.Lock()
	if s.bpmScan != nil {
		s.scanMu.Unlock()
		jsonError(w, "BPM-analyse kører allerede — vent til den er færdig", http.StatusConflict)
		return
	}
	s.bpmScan = &bpmScanInfo{}
	s.scanMu.Unlock()

	analyzer := music.NewBPMAnalyzer(s.db)
	progress := make(chan music.BPMProgress, 10)

	go func() {
		if err := analyzer.AnalyzeMissing(progress); err != nil {
			log.Printf("[bpm-scan] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done || p.Error != "" {
				s.bpmScan = nil
			} else {
				s.bpmScan = &bpmScanInfo{Total: p.Total, Processed: p.Processed}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast("bpm_scan_progress", p)
		}
	}()

	jsonOK(w, map[string]string{"status": "bpm scan started"})
}

// handleAnalyzeBPMAll resets BPM to 0 for all local tracks and re-analyzes every one.
func (s *Server) handleAnalyzeBPMAll(w http.ResponseWriter, r *http.Request) {
	s.scanMu.Lock()
	if s.bpmScan != nil {
		s.scanMu.Unlock()
		jsonError(w, "BPM-analyse kører allerede — vent til den er færdig", http.StatusConflict)
		return
	}
	s.bpmScan = &bpmScanInfo{}
	s.scanMu.Unlock()

	analyzer := music.NewBPMAnalyzer(s.db)
	progress := make(chan music.BPMProgress, 10)

	go func() {
		if err := analyzer.AnalyzeAll(progress); err != nil {
			log.Printf("[bpm-scan-all] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.scanMu.Lock()
			if p.Done || p.Error != "" {
				s.bpmScan = nil
			} else {
				s.bpmScan = &bpmScanInfo{Total: p.Total, Processed: p.Processed}
			}
			s.scanMu.Unlock()
			s.hub.Broadcast("bpm_scan_progress", p)
		}
	}()

	jsonOK(w, map[string]string{"status": "full bpm rescan started"})
}

func (s *Server) handleGetScanStatus(w http.ResponseWriter, r *http.Request) {
	s.scanMu.RLock()
	lib := s.libraryScan
	art := s.artworkScan
	bpm := s.bpmScan
	s.scanMu.RUnlock()

	jsonOK(w, map[string]any{
		"library_scanning": lib != nil,
		"library_progress": lib,
		"artwork_scanning": art != nil,
		"artwork_progress": art,
		"bpm_scanning":     bpm != nil,
		"bpm_progress":     bpm,
	})
}

func (s *Server) handleGetKeyboardBindings(w http.ResponseWriter, r *http.Request) {
	var bindings []db.KeyboardBinding
	_ = s.db.Select(&bindings, `SELECT * FROM keyboard_bindings ORDER BY action`)
	jsonOK(w, bindings)
}

func (s *Server) handleUpdateKeyboardBindings(w http.ResponseWriter, r *http.Request) {
	var bindings []db.KeyboardBinding
	if err := json.NewDecoder(r.Body).Decode(&bindings); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	tx, _ := s.db.BeginTxx(r.Context(), nil)
	defer tx.Rollback()
	for _, b := range bindings {
		tx.ExecContext(r.Context(),
			`INSERT OR REPLACE INTO keyboard_bindings (action, key_code, label) VALUES (?, ?, ?)`,
			b.Action, b.KeyCode, b.Label)
	}
	tx.Commit()
	jsonOK(w, map[string]string{"status": "updated"})
}

// ─────────────────────────────────────────────────────────────
// Playlist handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleListPlaylists(w http.ResponseWriter, r *http.Request) {
	var playlists []db.Playlist
	_ = s.db.Select(&playlists, `SELECT * FROM playlists ORDER BY name`)
	jsonOK(w, playlists)
}

// handleListSkaalPlaylists returns only user-created (source_type='local') playlists.
// Folder-generated playlists (source_type='folder') are intentionally excluded.
func (s *Server) handleListSkaalPlaylists(w http.ResponseWriter, r *http.Request) {
	var playlists []db.Playlist
	_ = s.db.Select(&playlists, `SELECT * FROM playlists WHERE source_type = 'local' ORDER BY name`)
	if playlists == nil {
		playlists = []db.Playlist{}
	}
	jsonOK(w, playlists)
}

func (s *Server) handleUpdatePlaylist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		IsPartyPlaylist *bool `json:"is_party_playlist"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.IsPartyPlaylist != nil {
		if *req.IsPartyPlaylist {
			// Ensure only one party playlist at a time
			s.db.Exec(`UPDATE playlists SET is_party_playlist = 0`)
			s.db.Exec(`UPDATE playlists SET is_party_playlist = 1 WHERE id = ?`, id)
			s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', ?, CURRENT_TIMESTAMP)`, id)
		} else {
			s.db.Exec(`UPDATE playlists SET is_party_playlist = 0 WHERE id = ?`, id)
			s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', '', CURRENT_TIMESTAMP)`)
		}
	}
	jsonOK(w, map[string]string{"status": "updated"})
}

func (s *Server) handleDeletePlaylist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Check if this is the active party playlist
	var currentPartyID string
	_ = s.db.Get(&currentPartyID, `SELECT value FROM settings WHERE key = 'party_playlist_id' LIMIT 1`)
	if currentPartyID == id {
		// Clear the party playlist setting
		s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', '', CURRENT_TIMESTAMP)`)
	}

	// Delete playlist (will cascade delete tracks due to FK)
	_, err := s.db.Exec(`DELETE FROM playlists WHERE id = ?`, id)
	if err != nil {
		jsonError(w, "kunne ikke slette playliste", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleCreatePlaylist(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name            string `json:"name"`
		IsPartyPlaylist bool   `json:"is_party_playlist"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		jsonError(w, "name required", http.StatusBadRequest)
		return
	}

	pl := db.Playlist{
		ID:              uuid.NewString(),
		Name:            req.Name,
		SourceType:      "local",
		IsPartyPlaylist: req.IsPartyPlaylist,
		CreatedAt:       time.Now(),
	}

	s.db.Exec(`INSERT INTO playlists (id, name, source_type, is_party_playlist, created_at) VALUES (?, ?, ?, ?, ?)`,
		pl.ID, pl.Name, pl.SourceType, pl.IsPartyPlaylist, pl.CreatedAt)

	if req.IsPartyPlaylist {
		s.db.Exec(`UPDATE playlists SET is_party_playlist = 0 WHERE id != ?`, pl.ID)
		s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', ?, CURRENT_TIMESTAMP)`, pl.ID)
	}

	w.WriteHeader(http.StatusCreated)
	jsonOK(w, pl)
}

func (s *Server) handleAddPlaylistTrack(w http.ResponseWriter, r *http.Request) {
	playlistID := chi.URLParam(r, "id")
	var req struct {
		TrackID string `json:"track_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TrackID == "" {
		jsonError(w, "track_id required", http.StatusBadRequest)
		return
	}

	var maxPos int
	_ = s.db.Get(&maxPos, `SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?`, playlistID)

	s.db.Exec(`INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
		playlistID, req.TrackID, maxPos+1)

	jsonOK(w, map[string]string{"status": "added"})
}

type playlistTrackRow struct {
	db.Track
	IsIntro bool `db:"is_intro" json:"is_intro"`
}

func (s *Server) handleGetPlaylistTracks(w http.ResponseWriter, r *http.Request) {
	playlistID := chi.URLParam(r, "id")
	var tracks []playlistTrackRow
	_ = s.db.Select(&tracks, `
		SELECT
			t.id, t.album_id, t.artist_id, t.title,
			t.track_number, t.disc_number, t.duration, t.bpm,
			t.file_path, t.source_type, t.source_id, t.stream_url,
			t.created_at, t.updated_at,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id,
			pt.is_intro
		FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, playlistID)
	jsonOK(w, tracks)
}

// handleSetPlaylistIntroTrack toggles is_intro on a specific playlist_tracks row.
// Body: { "track_id": "...", "is_intro": true|false }
func (s *Server) handleSetPlaylistIntroTrack(w http.ResponseWriter, r *http.Request) {
	playlistID := chi.URLParam(r, "id")
	var req struct {
		TrackID string `json:"track_id"`
		IsIntro bool   `json:"is_intro"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TrackID == "" {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	var count int
	_ = s.db.Get(&count, `SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`, playlistID, req.TrackID)
	if count == 0 {
		jsonError(w, "track not in playlist", http.StatusBadRequest)
		return
	}
	isIntroVal := 0
	if req.IsIntro {
		isIntroVal = 1
	}
	if _, err := s.db.Exec(`UPDATE playlist_tracks SET is_intro = ? WHERE playlist_id = ? AND track_id = ?`, isIntroVal, playlistID, req.TrackID); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "updated"})
}

func (s *Server) handleRemovePlaylistTrack(w http.ResponseWriter, r *http.Request) {
	playlistID := chi.URLParam(r, "id")
	trackID := chi.URLParam(r, "trackId")
	s.db.Exec(`DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`, playlistID, trackID)
	jsonOK(w, map[string]string{"status": "removed"})
}

func (s *Server) ensureGlobalPartyPlaylist() (string, error) {
	var playlistID string
	if err := s.db.Get(&playlistID, `SELECT value FROM settings WHERE key = 'party_playlist_id' LIMIT 1`); err == nil && strings.TrimSpace(playlistID) != "" {
		return playlistID, nil
	}

	var playlist db.Playlist
	if err := s.db.Get(&playlist, `SELECT * FROM playlists WHERE is_party_playlist = 1 ORDER BY created_at LIMIT 1`); err == nil {
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', ?, CURRENT_TIMESTAMP)`, playlist.ID)
		return playlist.ID, nil
	}

	playlist = db.Playlist{
		ID:              uuid.NewString(),
		Name:            "SKÅLE Uploads",
		SourceType:      "local",
		IsPartyPlaylist: true,
		CreatedAt:       time.Now(),
	}
	if _, err := s.db.Exec(`INSERT INTO playlists (id, name, source_type, is_party_playlist, created_at) VALUES (?, ?, ?, ?, ?)`,
		playlist.ID, playlist.Name, playlist.SourceType, playlist.IsPartyPlaylist, playlist.CreatedAt); err != nil {
		return "", err
	}
	_, _ = s.db.Exec(`UPDATE playlists SET is_party_playlist = 0 WHERE id != ?`, playlist.ID)
	_, _ = s.db.Exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('party_playlist_id', ?, CURRENT_TIMESTAMP)`, playlist.ID)
	return playlist.ID, nil
}

func (s *Server) handleUploadPartyPlaylistTracks(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		jsonError(w, "kunne ikke læse upload", http.StatusBadRequest)
		return
	}

	playlistID, err := s.ensureGlobalPartyPlaylist()
	if err != nil {
		jsonError(w, "kunne ikke oprette global skåle-playliste", http.StatusInternalServerError)
		return
	}

	uploadDir := config.GlobalPartyUploadsDir(s.cfg.DBPath)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		jsonError(w, "kunne ikke oprette upload-mappe", http.StatusInternalServerError)
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		jsonError(w, "vælg mindst én lydfil", http.StatusBadRequest)
		return
	}

	type uploadedTrack struct {
		TrackID string `json:"track_id"`
		Title   string `json:"title"`
		Path    string `json:"path"`
	}
	uploaded := make([]uploadedTrack, 0, len(files))

	for _, fileHeader := range files {
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if !music.SupportedExtension(ext) {
			continue
		}

		src, err := fileHeader.Open()
		if err != nil {
			continue
		}

		safeName := uuid.NewString() + ext
		destPath := filepath.Join(uploadDir, safeName)
		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			continue
		}
		_, copyErr := io.Copy(dst, src)
		dst.Close()
		src.Close()
		if copyErr != nil {
			_ = os.Remove(destPath)
			continue
		}

		if err := s.scanner.IndexPartyFile(destPath, fileHeader.Filename); err != nil {
			_ = os.Remove(destPath)
			continue
		}

		var track db.Track
		if err := s.db.Get(&track, `SELECT * FROM tracks WHERE file_path = ? LIMIT 1`, destPath); err != nil {
			continue
		}

		var maxPos int
		_ = s.db.Get(&maxPos, `SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?`, playlistID)
		_, _ = s.db.Exec(`INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`, playlistID, track.ID, maxPos+1)

		var album db.Album
		if err := s.db.Get(&album, `SELECT * FROM albums WHERE id = ? LIMIT 1`, track.AlbumID); err == nil {
			_ = s.artExt.ExtractForAlbum(&album)
		}

		uploaded = append(uploaded, uploadedTrack{TrackID: track.ID, Title: track.Title, Path: destPath})
	}

	if len(uploaded) == 0 {
		jsonError(w, "ingen gyldige lydfiler blev uploadet", http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]any{
		"status":      "uploaded",
		"playlist_id": playlistID,
		"uploaded":    uploaded,
	})
}

// handleUploadPartyFiles uploads MP3 files and indexes them as tracks but does NOT
// assign them to any playlist. Returns the indexed track records so the admin can
// drag/double-click them into a specific playlist via the UI.
func (s *Server) handleUploadPartyFiles(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		jsonError(w, "kunne ikke læse upload", http.StatusBadRequest)
		return
	}

	uploadDir := config.GlobalPartyUploadsDir(s.cfg.DBPath)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		jsonError(w, "kunne ikke oprette upload-mappe", http.StatusInternalServerError)
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		jsonError(w, "vælg mindst én lydfil", http.StatusBadRequest)
		return
	}

	type uploadedTrack struct {
		TrackID  string `json:"track_id"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		Duration int    `json:"duration_secs"`
	}
	uploaded := make([]uploadedTrack, 0, len(files))

	for _, fileHeader := range files {
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if !music.SupportedExtension(ext) {
			continue
		}

		src, err := fileHeader.Open()
		if err != nil {
			continue
		}

		safeName := uuid.NewString() + ext
		destPath := filepath.Join(uploadDir, safeName)
		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			continue
		}
		_, copyErr := io.Copy(dst, src)
		dst.Close()
		src.Close()
		if copyErr != nil {
			_ = os.Remove(destPath)
			continue
		}

		if err := s.scanner.IndexPartyFile(destPath, fileHeader.Filename); err != nil {
			_ = os.Remove(destPath)
			continue
		}

		var track db.Track
		if err := s.db.Get(&track, `
			SELECT t.*, COALESCE(ar.name,'') AS artist, COALESCE(al.title,'') AS album
			FROM tracks t
			LEFT JOIN artists ar ON ar.id = t.artist_id
			LEFT JOIN albums al ON al.id = t.album_id
			WHERE t.file_path = ? LIMIT 1`, destPath); err != nil {
			continue
		}

		// Extract artwork if available
		var album db.Album
		if err := s.db.Get(&album, `SELECT * FROM albums WHERE id = ? LIMIT 1`, track.AlbumID); err == nil {
			_ = s.artExt.ExtractForAlbum(&album)
		}

		uploaded = append(uploaded, uploadedTrack{
			TrackID:  track.ID,
			Title:    track.Title,
			Artist:   track.Artist,
			Duration: track.Duration,
		})
	}

	if len(uploaded) == 0 {
		jsonError(w, "ingen gyldige lydfiler blev uploadet", http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]any{"uploaded": uploaded})
}

// handleListPartyUploads returns all tracks whose file lives in the party uploads directory.
// These are tracks that have been uploaded but may not yet belong to any playlist.
func (s *Server) handleListPartyUploads(w http.ResponseWriter, r *http.Request) {
	uploadDir := filepath.Clean(config.GlobalPartyUploadsDir(s.cfg.DBPath))
	// SQLite LIKE requires % wildcard; use the cleaned path as prefix.
	prefix := uploadDir + string(filepath.Separator) + "%"

	var tracks []playlistTrackRow
	if err := s.db.Select(&tracks, `
		SELECT
			t.id, t.album_id, t.artist_id, t.title,
			t.track_number, t.disc_number, t.duration, t.bpm,
			t.file_path, t.source_type, t.source_id, t.stream_url,
			t.cover_art_id, t.created_at, t.updated_at,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			0 AS is_intro
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.file_path LIKE ?
		ORDER BY t.created_at DESC`, prefix); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	if tracks == nil {
		tracks = []playlistTrackRow{}
	}
	jsonOK(w, tracks)
}

// handleDeletePartyUpload deletes a SKÅL upload track: removes from all playlists,
// deletes the track (and album if empty), and removes the file from disk.
func (s *Server) handleDeletePartyUpload(w http.ResponseWriter, r *http.Request) {
	trackID := chi.URLParam(r, "id")

	var track db.Track
	if err := s.db.Get(&track, `SELECT * FROM tracks WHERE id = ? AND source_type = 'party_upload' LIMIT 1`, trackID); err != nil {
		jsonError(w, "track ikke fundet", http.StatusNotFound)
		return
	}

	albumID := track.AlbumID

	// Remove from all playlists
	_, _ = s.db.Exec(`DELETE FROM playlist_tracks WHERE track_id = ?`, trackID)

	// Delete track
	if _, err := s.db.Exec(`DELETE FROM tracks WHERE id = ?`, trackID); err != nil {
		jsonError(w, "kunne ikke slette track", http.StatusInternalServerError)
		return
	}

	// Delete album if it has no remaining tracks
	var remaining int
	_ = s.db.Get(&remaining, `SELECT COUNT(*) FROM tracks WHERE album_id = ?`, albumID)
	if remaining == 0 {
		_, _ = s.db.Exec(`DELETE FROM album_art WHERE album_id = ?`, albumID)
		_, _ = s.db.Exec(`DELETE FROM albums WHERE id = ?`, albumID)
	}

	// Delete file from disk
	if track.FilePath != "" {
		_ = os.Remove(track.FilePath)
	}

	jsonOK(w, map[string]string{"status": "deleted"})
}

// handleSetPlaylistTrackOrder reorders the intro tracks within a playlist by setting
// explicit positions. Body: { "order": ["track_id1", "track_id2", ...] }
func (s *Server) handleSetPlaylistTrackOrder(w http.ResponseWriter, r *http.Request) {
	playlistID := chi.URLParam(r, "id")
	var req struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Order) == 0 {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	for i, trackID := range req.Order {
		if _, err := tx.Exec(`UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?`, i+1, playlistID, trackID); err != nil {
			jsonError(w, "db error", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "reordered"})
}

var audioExts = map[string]bool{
	".mp3": true, ".flac": true, ".m4a": true, ".ogg": true,
	".aac": true, ".wav": true, ".opus": true, ".wma": true,
}

// cachedMusicSize returns the total bytes and file count of audio files in the music
// directory. Results are cached for 5 minutes to avoid hammering network mounts.
func (s *Server) cachedMusicSize() (bytes int64, count int64) {
	s.musicSizeMu.Lock()
	defer s.musicSizeMu.Unlock()
	if time.Since(s.musicSizeAt) < 5*time.Minute {
		return s.musicSizeBytes, s.musicFileCount
	}
	var b, c int64
	_ = filepath.Walk(s.cfg.MusicDir, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if audioExts[strings.ToLower(filepath.Ext(info.Name()))] {
			b += info.Size()
			c++
		}
		return nil
	})
	s.musicSizeBytes, s.musicFileCount, s.musicSizeAt = b, c, time.Now()
	return b, c
}

// handleSystemMetrics returns current system resource usage.
func (s *Server) handleSystemMetrics(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// Convert bytes to MB for readability
	allocMB := float64(m.Alloc) / 1024 / 1024
	sysMB := float64(m.Sys) / 1024 / 1024

	// Get database stats — only count content that is actually usable in the jukebox:
	// • local and subsonic tracks (not party_upload or other internal types)
	// • only tracks with a known duration (duration > 0) — broken/unreadable files excluded
	// • albums and artists that have at least one such track
	var trackCount, albumCount, artistCount, userCount, roomCount int
	var bpmWith, bpmWithout int
	var totalDurationSecs int64
	_ = s.db.Get(&trackCount, `
		SELECT COUNT(*) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0`)
	_ = s.db.Get(&albumCount, `
		SELECT COUNT(DISTINCT album_id) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0`)
	_ = s.db.Get(&artistCount, `
		SELECT COUNT(DISTINCT artist_id) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0`)
	_ = s.db.Get(&userCount, `SELECT COUNT(*) FROM users`)
	_ = s.db.Get(&roomCount, `SELECT COUNT(*) FROM rooms`)
	_ = s.db.Get(&bpmWith, `
		SELECT COUNT(*) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0 AND bpm > 0`)
	_ = s.db.Get(&bpmWithout, `
		SELECT COUNT(*) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0 AND bpm = 0`)
	_ = s.db.Get(&totalDurationSecs, `
		SELECT COALESCE(SUM(duration), 0) FROM tracks
		WHERE source_type IN ('local', 'subsonic') AND duration > 0`)

	libBytes, libCount := s.cachedMusicSize()

	jsonOK(w, map[string]any{
		"memory": map[string]any{
			"alloc_mb":  fmt.Sprintf("%.2f", allocMB),
			"sys_mb":    fmt.Sprintf("%.2f", sysMB),
			"gc_cycles": m.NumGC,
		},
		"runtime": map[string]any{
			"goroutines": runtime.NumGoroutine(),
			"go_version": runtime.Version(),
			"num_cpu":    runtime.NumCPU(),
		},
		"database": map[string]any{
			"tracks":               trackCount,
			"albums":               albumCount,
			"artists":              artistCount,
			"users":                userCount,
			"rooms":                roomCount,
			"total_duration_secs":  totalDurationSecs,
		},
		"bpm": map[string]any{
			"with_bpm":    bpmWith,
			"without_bpm": bpmWithout,
		},
		"disk": map[string]any{
			"size_bytes":  libBytes,
			"file_count":  libCount,
		},
		"uptime_seconds": time.Since(s.startTime).Seconds(),
	})
}

// ─────────────────────────────────────────────────────────────
// SMTP handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleGetSMTP(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.emailSvc.LoadConfig(r.Context())
	if err != nil {
		jsonError(w, "could not load smtp config", http.StatusInternalServerError)
		return
	}
	// Never return the actual password - just indicate if it's set
	jsonOK(w, map[string]any{
		"enabled":      cfg.Enabled,
		"host":         cfg.Host,
		"port":         cfg.Port,
		"username":     cfg.Username,
		"password_set": cfg.Password != "",
		"from":         cfg.From,
		"from_name":    cfg.FromName,
	})
}

func (s *Server) handleUpdateSMTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled  bool   `json:"enabled"`
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
		From     string `json:"from"`
		FromName string `json:"from_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	port := req.Port
	if port == 0 {
		port = 587
	}
	fromName := req.FromName
	if fromName == "" {
		fromName = "CrownJukebox"
	}

	enabled := "0"
	if req.Enabled {
		enabled = "1"
	}

	updates := map[string]string{
		"smtp_enabled":   enabled,
		"smtp_host":      req.Host,
		"smtp_port":      fmt.Sprintf("%d", port),
		"smtp_username":  req.Username,
		"smtp_from":      req.From,
		"smtp_from_name": fromName,
	}
	// Only update password if a new one was provided
	if req.Password != "" {
		updates["smtp_password"] = req.Password
	}

	for k, v := range updates {
		if _, err := s.db.ExecContext(r.Context(), `UPDATE settings SET value = ? WHERE key = ?`, v, k); err != nil {
			jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	jsonOK(w, map[string]string{"status": "saved"})
}

func (s *Server) handleTestSMTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.To == "" {
		jsonError(w, "modtager email kræves", http.StatusBadRequest)
		return
	}

	err := s.emailSvc.SendTest(r.Context(), req.To)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	jsonOK(w, map[string]string{"status": "sent"})
}

// ─────────────────────────────────────────────────────────────
// YouTube API key handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleGetYouTubeSettings(w http.ResponseWriter, r *http.Request) {
	var key string
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(value,'') FROM settings WHERE key = 'youtube_api_key'`).Scan(&key)
	jsonOK(w, map[string]any{
		"api_key_set": key != "",
	})
}

func (s *Server) handleUpdateYouTubeSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		APIKey string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	// Allow clearing the key by sending an empty string
	_, err := s.db.ExecContext(r.Context(),
		`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('youtube_api_key', ?, CURRENT_TIMESTAMP)`,
		req.APIKey)
	if err != nil {
		jsonError(w, "database error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "updated"})
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

func (s *Server) broadcastQueueChange(ctx context.Context) {
	rm := getRoomFromCtx(ctx)
	if rm == nil {
		return
	}
	items, _ := rm.Queue.GetQueue(ctx)
	s.hub.BroadcastToRoom(rm.Info.ID, events.EventQueueChanged, map[string]any{"items": items})
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, `{"error":%q}`, msg)
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		var i int
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil {
			return i
		}
	}
	return def
}

func audioContentType(path string) string {
	switch {
	case len(path) > 5 && path[len(path)-5:] == ".flac":
		return "audio/flac"
	case len(path) > 4 && path[len(path)-4:] == ".ogg":
		return "audio/ogg"
	case len(path) > 4 && path[len(path)-4:] == ".m4a":
		return "audio/mp4"
	default:
		return "audio/mpeg"
	}
}

func servePlaceholder(w http.ResponseWriter, size string) {
	// Return a minimal retro-gradient SVG as placeholder
	px := 300
	switch size {
	case "small":
		px = 128
	case "large":
		px = 600
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">
		<defs>
			<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%%" stop-color="#1a0a2e"/>
				<stop offset="100%%" stop-color="#b400ff"/>
			</linearGradient>
		</defs>
		<rect width="100%%" height="100%%" fill="url(#g)"/>
		<circle cx="%d" cy="%d" r="%d" fill="none" stroke="#ffffff22" stroke-width="4"/>
		<circle cx="%d" cy="%d" r="8" fill="#00000088"/>
	</svg>`, px, px, px/2, px/2, px/3, px/2, px/2)

	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write([]byte(svg))
}

func userResponse(u db.User) map[string]any {
	return map[string]any{
		"id":                u.ID,
		"display_name":      u.DisplayName,
		"email":             u.Email,
		"username":          u.Username,
		"role":              u.Role,
		"is_active":         u.IsActive,
		"is_permanent":      u.IsPermanent,
		"access_expires_at": u.AccessExpiresAt,
		"created_at":        u.CreatedAt,
		"last_seen_at":      u.LastSeenAt,
		"force_pin_change":  u.ForcePinChange,
	}
}

func sanitizeUsers(users []db.User) []map[string]any {
	result := make([]map[string]any, len(users))
	for i, u := range users {
		result[i] = userResponse(u)
	}
	return result
}

// ─────────────────────────────────────────────────────────────
// MusicBrainz / Album Fixer handlers
// ─────────────────────────────────────────────────────────────

// FragmentedAlbumGroup describes a set of album rows in the DB that all share
// the same title but were split because individual tracks had different artist tags.
type FragmentedAlbumGroup struct {
	Title         string   `json:"title"`
	FragmentCount int      `json:"fragment_count"`
	TotalTracks   int      `json:"total_tracks"`
	AlbumIDs      []string `json:"album_ids"`
	Artists       []string `json:"artists"`
}

// handleFragmentedAlbums returns local albums where multiple DB rows share the
// same title (i.e. they appear fragmented due to inconsistent artist tags).
func (s *Server) handleFragmentedAlbums(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Title         string `db:"title"`
		FragmentCount int    `db:"fragment_count"`
		TotalTracks   int    `db:"total_tracks"`
		AlbumIDs      string `db:"album_ids"`
		Artists       string `db:"artists"`
	}
	var rows []row
	err := s.db.Select(&rows, `
		SELECT
			al.title,
			COUNT(DISTINCT al.id)                          AS fragment_count,
			COALESCE(SUM(al.track_count), 0)               AS total_tracks,
			GROUP_CONCAT(al.id, '|')                       AS album_ids,
			GROUP_CONCAT(DISTINCT ar.name, ' / ')          AS artists
		FROM albums al
		JOIN artists ar ON ar.id = al.artist_id
		WHERE al.source_type = 'local'
		GROUP BY al.title
		HAVING COUNT(DISTINCT al.id) > 1
		ORDER BY SUM(al.track_count) DESC
		LIMIT 300`)
	if err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	result := make([]FragmentedAlbumGroup, 0, len(rows))
	for _, r := range rows {
		ids := strings.Split(r.AlbumIDs, "|")
		arts := strings.Split(r.Artists, " / ")
		result = append(result, FragmentedAlbumGroup{
			Title:         r.Title,
			FragmentCount: r.FragmentCount,
			TotalTracks:   r.TotalTracks,
			AlbumIDs:      ids,
			Artists:       arts,
		})
	}
	jsonOK(w, result)
}

// handleMusicBrainzSearch proxies a MusicBrainz release-group search.
// Query param: title
func (s *Server) handleMusicBrainzSearch(w http.ResponseWriter, r *http.Request) {
	title := r.URL.Query().Get("title")
	if title == "" {
		jsonError(w, "title is required", http.StatusBadRequest)
		return
	}

	results, err := musicbrainz.SearchReleaseGroups(title)
	if err != nil {
		log.Printf("[musicbrainz] search %q: %v", title, err)
		jsonError(w, "MusicBrainz søgning fejlede", http.StatusBadGateway)
		return
	}

	type result struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		PrimaryType string `json:"primary_type"`
		Compilation bool   `json:"compilation"`
		ArtistName  string `json:"artist_name"`
		Score       int    `json:"score"`
	}
	out := make([]result, 0, len(results))
	for _, rg := range results {
		out = append(out, result{
			ID:          rg.ID,
			Title:       rg.Title,
			PrimaryType: rg.PrimaryType,
			Compilation: rg.IsCompilation(),
			ArtistName:  rg.ArtistName(),
			Score:       rg.Score,
		})
	}
	jsonOK(w, out)
}

// handleMergeAlbums merges a set of fragmented album rows into one and
// optionally writes the corrected AlbumArtist tag back to the audio files.
func (s *Server) handleMergeAlbums(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AlbumIDs    []string `json:"album_ids"`
		AlbumArtist string   `json:"album_artist"`
		WriteFiles  bool     `json:"write_files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if len(req.AlbumIDs) < 2 {
		jsonError(w, "at least 2 album_ids required", http.StatusBadRequest)
		return
	}
	if req.AlbumArtist == "" {
		jsonError(w, "album_artist is required", http.StatusBadRequest)
		return
	}

	// Upsert the target artist.
	var artistID string
	var existing db.Artist
	if err := s.db.Get(&existing, `SELECT * FROM artists WHERE name = ? LIMIT 1`, req.AlbumArtist); err == nil {
		artistID = existing.ID
	} else {
		artistID = uuid.NewString()
		if _, err := s.db.Exec(
			`INSERT INTO artists (id, name, sort_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			artistID, req.AlbumArtist, req.AlbumArtist, time.Now(), time.Now()); err != nil {
			jsonError(w, "db error", http.StatusInternalServerError)
			return
		}
	}

	// Winner is first album ID; all others get merged into it.
	winner := req.AlbumIDs[0]
	losers := req.AlbumIDs[1:]

	// Update winner's artist.
	if _, err := s.db.Exec(
		`UPDATE albums SET artist_id = ?, album_artist_id = ?, updated_at = ? WHERE id = ?`,
		artistID, artistID, time.Now(), winner); err != nil {
		jsonError(w, "db error", http.StatusInternalServerError)
		return
	}

	// Collect file paths before moving tracks (needed for tag writing).
	var filePaths []string
	if req.WriteFiles {
		if err := s.db.Select(&filePaths, `SELECT file_path FROM tracks WHERE album_id = ANY(?)`, req.AlbumIDs); err != nil {
			// Fallback: collect per ID
			filePaths = nil
			for _, id := range req.AlbumIDs {
				var fps []string
				_ = s.db.Select(&fps, `SELECT file_path FROM tracks WHERE album_id = ?`, id)
				filePaths = append(filePaths, fps...)
			}
		}
	}

	// Move all tracks from losers to winner.
	for _, loserID := range losers {
		if _, err := s.db.Exec(
			`UPDATE tracks SET album_id = ?, updated_at = ? WHERE album_id = ?`,
			winner, time.Now(), loserID); err != nil {
			jsonError(w, "db error", http.StatusInternalServerError)
			return
		}
	}

	// Delete now-empty loser albums.
	for _, loserID := range losers {
		s.db.Exec(`DELETE FROM albums WHERE id = ?`, loserID)
	}

	// Update winner track_count.
	s.db.Exec(`
		UPDATE albums SET track_count = (
			SELECT COUNT(*) FROM tracks WHERE album_id = ?
		), updated_at = ? WHERE id = ?`, winner, time.Now(), winner)

	// Write tags if requested (background — we don't block the HTTP response).
	var tagErrors []string
	if req.WriteFiles && len(filePaths) > 0 {
		for _, fp := range filePaths {
			if err := music.WriteAlbumArtistTag(fp, req.AlbumArtist); err != nil {
				log.Printf("[merge-albums] tag write %s: %v", fp, err)
				tagErrors = append(tagErrors, filepath.Base(fp))
			}
		}
	}

	resp := map[string]any{
		"status":      "merged",
		"winner_id":   winner,
		"merged":      len(losers),
		"tag_errors":  tagErrors,
		"tags_written": req.WriteFiles && len(tagErrors) == 0,
	}
	jsonOK(w, resp)
}
