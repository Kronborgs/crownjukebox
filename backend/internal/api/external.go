package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/crownjukebox/crownjukebox/internal/auth"
	"github.com/crownjukebox/crownjukebox/internal/events"
	"github.com/crownjukebox/crownjukebox/internal/external"
)

// writeExtError writes a JSON error response.
func writeExtError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc, _ := json.Marshal(map[string]string{"error": msg})
	w.Write(enc) //nolint:errcheck
}

// handleCreateExternalSession creates a new mobile QR session for the
// authenticated jukebox user and returns a connect URL to embed in a QR code.
func (s *Server) handleCreateExternalSession(w http.ResponseWriter, r *http.Request) {
	sd, ok := auth.GetSessionFromContext(r.Context())
	if !ok {
		writeExtError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	roomID := strings.TrimSpace(r.Header.Get("X-Room-ID"))
	if roomID == "" {
		writeExtError(w, http.StatusBadRequest, "missing X-Room-ID header")
		return
	}

	sess := s.externalStore.Create(roomID, sd.User.ID)
	publicURL, _ := s.getPublicBaseURL(r.Context())
	connectURL := publicURL + "/connect?s=" + sess.ID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"session_id":  sess.ID,
		"connect_url": connectURL,
	})
}

// handleExternalStatus returns the current status of a mobile QR session.
// This endpoint is public — authentication is the session token in the "s" param.
func (s *Server) handleExternalStatus(w http.ResponseWriter, r *http.Request) {
	sess := s.externalStore.Get(r.URL.Query().Get("s"))
	if sess == nil {
		writeExtError(w, http.StatusNotFound, "session not found or expired")
		return
	}

	type statusResp struct {
		Status    external.SessionStatus `json:"status"`
		AddedSong *external.AddedSong    `json:"added_song,omitempty"`
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statusResp{
		Status:    sess.Status,
		AddedSong: sess.AddedSong,
	})
}

// handleExternalYouTubeSearch proxies a query to the YouTube Data API v3.
// Requires a valid session token in the "s" query parameter.
func (s *Server) handleExternalYouTubeSearch(w http.ResponseWriter, r *http.Request) {
	sess := s.externalStore.Get(r.URL.Query().Get("s"))
	if sess == nil {
		writeExtError(w, http.StatusNotFound, "session not found or expired")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]")) //nolint:errcheck
		return
	}

	// Read API key from database (set via Admin → YouTube panel)
	var apiKey string
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(value,'') FROM settings WHERE key = 'youtube_api_key'`).Scan(&apiKey)

	results, err := external.SearchYouTube(apiKey, q)
	if err != nil {
		log.Printf("[external] youtube search: %v", err)
		writeExtError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// handleExternalQueueSong downloads a YouTube video as audio via yt-dlp,
// inserts it into the library database, and adds it to the room queue.
// This is a long-running handler (yt-dlp can take 30-120 s) — nginx is
// already configured with proxy_read_timeout 3600s.
func (s *Server) handleExternalQueueSong(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID   string `json:"session_id"`
		VideoID     string `json:"video_id"`
		Title       string `json:"title"`
		ChannelName string `json:"channel_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeExtError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sess := s.externalStore.Get(body.SessionID)
	if sess == nil {
		writeExtError(w, http.StatusNotFound, "session not found or expired")
		return
	}
	if body.VideoID == "" {
		writeExtError(w, http.StatusBadRequest, "video_id required")
		return
	}

	log.Printf("[external] queuing youtube:%s (%s) for room %s", body.VideoID, body.Title, sess.RoomID)

	added, err := external.DownloadAndQueue(
		r.Context(),
		s.db,
		s.cfg.ExternalMusicDir,
		body.VideoID,
		sess.RoomID,
		sess.UserID,
	)
	if err != nil {
		log.Printf("[external] download/queue failed: %v", err)
		writeExtError(w, http.StatusInternalServerError,
			fmt.Sprintf("download failed: %s", err.Error()))
		return
	}

	s.externalStore.MarkDone(body.SessionID, added)
	s.hub.BroadcastToRoom(sess.RoomID, events.EventQueueChanged, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"title":  added.Title,
		"artist": added.Artist,
	})
}
