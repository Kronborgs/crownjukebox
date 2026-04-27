package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
	"github.com/crownjukebox/crownjukebox/internal/music"
	"github.com/crownjukebox/crownjukebox/internal/rooms"
)

type contextKey string

const roomContextKey contextKey = "room"

// Server holds all service dependencies.
type Server struct {
	cfg      *config.Config
	version  string
	db       *sqlx.DB
	hub      *events.Hub
	authSvc  *auth.Service
	qrSvc    *auth.QRService
	roomSvc  *rooms.Service
	emailSvc *email.Service
	artExt   *artwork.Extractor
	scanner  *music.Scanner
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
		cfg:      cfg,
		version:  version,
		db:       database,
		hub:      hub,
		authSvc:  authSvc,
		qrSvc:    qrSvc,
		roomSvc:  roomSvc,
		emailSvc: emailSvc,
		artExt:   artExt,
		scanner:  scanner,
	}
}

func getBaseURL(cfg *config.Config) string {
	if v := cfg.SubsonicURL; v != "" {
		return v
	}
	return "http://localhost:" + cfg.Port
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

	// ─── Authenticated endpoints ──────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(s.authSvc))
		r.Use(s.roomMiddleware)

		r.Post("/api/auth/logout", s.handleLogout)
		r.Get("/api/auth/me", s.handleMe)

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

		// Party
		r.Post("/api/party/cheers", auth.RequirePermission(s.authSvc, "can_use_party_button")(http.HandlerFunc(s.handleCheers)).ServeHTTP)
		r.Get("/api/party/state", s.handlePartyState)

		// SSE (room_id via query param for EventSource)
		r.Get("/api/events", s.handleSSE)
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

		// Settings & scanning
		r.Get("/api/settings", s.handleGetSettings)
		r.Put("/api/settings", s.handleUpdateSettings)
		r.Post("/api/admin/rescan", s.handleRescan)
		r.Post("/api/admin/rescan-artwork", s.handleRescanArtwork)
		r.Post("/api/admin/rescan-missing-artwork", s.handleRescanMissingArtwork)
		r.Get("/api/admin/missing-artwork", s.handleAdminMissingArtwork)
		r.Get("/api/admin/keyboard-bindings", s.handleGetKeyboardBindings)
		r.Put("/api/admin/keyboard-bindings", s.handleUpdateKeyboardBindings)

		// Party playlist management
		r.Get("/api/admin/playlists", s.handleListPlaylists)
		r.Post("/api/admin/playlists", s.handleCreatePlaylist)
		r.Patch("/api/admin/playlists/{id}", s.handleUpdatePlaylist)
		r.Post("/api/admin/playlists/{id}/tracks", s.handleAddPlaylistTrack)
		r.Delete("/api/admin/playlists/{id}/tracks/{trackId}", s.handleRemovePlaylistTrack)
		r.Post("/api/admin/party-playlist/upload", s.handleUploadPartyPlaylistTracks)
	})

	return r
}

// ─────────────────────────────────────────────────────────────
// Auth handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Pin      string `json:"pin"`
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
		       created_by_admin_id, created_at, updated_at, last_seen_at
		FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1`, req.Username); err != nil {
		log.Printf("[login] user lookup failed for %q: %v", req.Username, err)
		// Constant-time delay to prevent timing attacks
		bcrypt.GenerateFromPassword([]byte("dummy"), bcrypt.MinCost)
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if !auth.CheckPassword(user.PinHash, req.Pin) {
		log.Printf("[login] password check failed for user %q (hash len=%d)", user.Username, len(user.PinHash))
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := s.authSvc.CreateSession(r.Context(), user.ID,
		r.Header.Get("User-Agent"), r.Header.Get("User-Agent"), r.RemoteAddr)
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
		jsonError(w, "invalid or expired QR token: "+err.Error(), http.StatusUnauthorized)
		return
	}

	var user db.User
	if err := s.db.Get(&user, `SELECT * FROM users WHERE id = ?`, userID); err != nil {
		jsonError(w, "user not found", http.StatusUnauthorized)
		return
	}

	token, err := s.authSvc.CreateSession(r.Context(), user.ID,
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
		"user":        userResponse(sd.User),
		"permissions": sd.Permissions,
	})
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
		LEFT JOIN album_art aa ON aa.id = al.cover_art_id`

	if artistID != "" {
		s.db.Select(&albums, q+` WHERE al.artist_id = ? ORDER BY al.year DESC, al.title ASC LIMIT ? OFFSET ?`,
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
			t.track_number, t.disc_number, t.duration,
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
			t.track_number, t.disc_number, t.duration,
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

	var artists []db.Artist
	_ = s.db.Select(&artists, `SELECT * FROM artists WHERE name LIKE ? LIMIT 10`, like)

	var albums []db.Album
	_ = s.db.Select(&albums, `SELECT * FROM albums WHERE title LIKE ? LIMIT 20`, like)

	var tracks []db.Track
	_ = s.db.Select(&tracks, `
		SELECT
			t.*,
			COALESCE(ar.name, '') AS artist,
			COALESCE(al.title, '') AS album,
			COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
		FROM tracks t
		LEFT JOIN artists ar ON ar.id = t.artist_id
		LEFT JOIN albums al ON al.id = t.album_id
		WHERE t.title LIKE ?
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
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Auto-start playback if nothing is currently playing
	if curState, _ := rm.Playback.GetState(r.Context()); curState != nil && !curState.IsPlaying {
		_ = rm.Playback.Play(r.Context(), "", userID)
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
	jsonOK(w, state)
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

	// Security: reject paths that escape allowed media directories.
	cleanTrack := filepath.Clean(track.FilePath)
	cleanMusic := filepath.Clean(s.cfg.MusicDir)
	cleanUploads := filepath.Clean(config.GlobalPartyUploadsDir(s.cfg.DBPath))
	allowedMusic := strings.HasPrefix(cleanTrack, cleanMusic+string(filepath.Separator)) || cleanTrack == cleanMusic
	allowedUploads := strings.HasPrefix(cleanTrack, cleanUploads+string(filepath.Separator)) || cleanTrack == cleanUploads
	if !allowedMusic && !allowedUploads {
		jsonError(w, "forbidden", http.StatusForbidden)
		return
	}

	// Determine content-type from file extension
	contentType := audioContentType(track.FilePath)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")

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
// Party handlers
// ─────────────────────────────────────────────────────────────

func (s *Server) handleCheers(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}

	rm := getRoomFromCtx(r.Context())
	track, err := rm.Party.TriggerCheers(r.Context(), userID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Start playing the party track
	rm.Playback.SetPartyMode(true, track.ID)
	if err := rm.Playback.Play(r.Context(), track.ID, userID); err != nil {
		log.Printf("[party] play error: %v", err)
	}

	jsonOK(w, map[string]any{
		"track":  track,
		"status": "party started",
	})
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

// roomMiddleware reads the X-Room-ID header (default: "default") and attaches
// the corresponding *rooms.Room to the request context.
func (s *Server) roomMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roomID := r.Header.Get("X-Room-ID")
		if roomID == "" {
			roomID = "default"
		}
		room := s.roomSvc.Get(r.Context(), roomID)
		if room == nil {
			room = s.roomSvc.Get(r.Context(), "default")
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
		jsonError(w, "clean admin permissions: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin')`); err != nil {
		jsonError(w, "clean admin sessions: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`DELETE FROM users WHERE role='admin'`); err != nil {
		jsonError(w, "clean admin user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	adminID := uuid.NewString()
	if _, err := tx.Exec(`
		INSERT INTO users (id, username, display_name, pin_hash, role, is_permanent, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'admin', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		adminID, req.AdminUsername, req.AdminUsername, string(hash)); err != nil {
		jsonError(w, "create admin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[setup] admin user created: %q id=%s", req.AdminUsername, adminID)

	if _, err := tx.Exec(`
		INSERT INTO user_permissions (user_id, can_add_to_queue, can_search, can_use_party_button, can_view_queue)
		VALUES (?, 1, 1, 1, 1)`, adminID); err != nil {
		jsonError(w, "admin permissions: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		jsonError(w, "commit: "+err.Error(), http.StatusInternalServerError)
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

	_, _ = s.db.Exec(`UPDATE settings SET value = '1' WHERE key = 'setup_completed'`)
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

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DisplayName    string `json:"display_name"`
		Username       string `json:"username"`
		Role           string `json:"role"`
		Pin            string `json:"pin"`
		IsPermanent    bool   `json:"is_permanent"`
		AccessDuration *int   `json:"access_duration_minutes"`
		CanAddToQueue  bool   `json:"can_add_to_queue"`
		CanSearch      bool   `json:"can_search"`
		CanUseParty    bool   `json:"can_use_party_button"`
		CanViewQueue   bool   `json:"can_view_queue"`
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
		Username:         req.Username,
		Role:             req.Role,
		PinHash:          pinHash,
		IsActive:         true,
		IsPermanent:      req.IsPermanent,
		CreatedByAdminID: createdByAdminID,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	if !req.IsPermanent && req.AccessDuration != nil {
		exp := time.Now().Add(time.Duration(*req.AccessDuration) * time.Minute)
		user.AccessExpiresAt = &exp
	}

	tx, _ := s.db.BeginTxx(r.Context(), nil)
	defer tx.Rollback()

	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO users (id, display_name, username, role, pin_hash, is_active, is_permanent,
		                   access_expires_at, created_by_admin_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.DisplayName, user.Username, user.Role, user.PinHash,
		user.IsActive, user.IsPermanent, user.AccessExpiresAt, user.CreatedByAdminID,
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

	w.WriteHeader(http.StatusCreated)
	jsonOK(w, userResponse(user))
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
	s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
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

	accessURL := getBaseURL(s.cfg) + "/qr/" + token

	if err := s.emailSvc.SendInvitation(r.Context(), req.Email, user.DisplayName, accessURL, expiry); err != nil {
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
	_ = s.authSvc.RevokeSession(r.Context(), id)
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
	progress := make(chan music.ScanProgress, 10)
	go func() {
		if err := s.scanner.Scan(progress); err != nil {
			log.Printf("[rescan] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
			s.hub.Broadcast(events.EventLibraryScanProgress, p)
		}
	}()
	jsonOK(w, map[string]string{"status": "scan started"})
}

func (s *Server) handleRescanArtwork(w http.ResponseWriter, r *http.Request) {
	progress := make(chan artwork.ExtractProgress, 10)
	go func() {
		if err := s.artExt.ExtractAll(progress); err != nil {
			log.Printf("[rescan-artwork] error: %v", err)
		}
	}()
	go func() {
		for p := range progress {
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

		if err := s.scanner.IndexFile(destPath); err != nil {
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
		"username":          u.Username,
		"role":              u.Role,
		"is_active":         u.IsActive,
		"is_permanent":      u.IsPermanent,
		"access_expires_at": u.AccessExpiresAt,
		"created_at":        u.CreatedAt,
		"last_seen_at":      u.LastSeenAt,
	}
}

func sanitizeUsers(users []db.User) []map[string]any {
	result := make([]map[string]any, len(users))
	for i, u := range users {
		result[i] = userResponse(u)
	}
	return result
}
