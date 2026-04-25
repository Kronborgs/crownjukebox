package events

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// EventType constants for all SSE events.
const (
	EventNowPlayingChanged      = "now_playing_changed"
	EventNowPlayingCoverChanged = "now_playing_cover_changed"
	EventQueueChanged           = "queue_changed"
	EventPlaybackStateChanged   = "playback_state_changed"
	EventPartyStarted           = "party_started"
	EventPartyEnded             = "party_ended"
	EventUserAccessRevoked      = "user_access_revoked"
	EventUserAccessExpired      = "user_access_expired"
	EventSettingsChanged        = "settings_changed"
	EventLibraryScanProgress    = "library_scan_progress"
	EventArtworkScanProgress    = "artwork_scan_progress"
	EventArtworkUpdated         = "artwork_updated"
	EventMissingArtworkFound    = "missing_artwork_found"
)

// Event is the structure broadcast to all SSE clients.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// client holds the channel used to push events to a connected SSE browser.
type client struct {
	ch     chan Event
	userID string
}

// Hub manages all active SSE connections.
type Hub struct {
	mu      sync.RWMutex
	clients map[*client]struct{}
}

// NewHub creates a new SSE hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*client]struct{}),
	}
}

// Broadcast sends an event to ALL connected clients.
func (h *Hub) Broadcast(eventType string, data any) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	ev := Event{Type: eventType, Data: data}
	for c := range h.clients {
		select {
		case c.ch <- ev:
		default:
			// Client is slow; skip to avoid blocking broadcast
		}
	}
}

// BroadcastToUser sends an event only to clients authenticated as the given user.
func (h *Hub) BroadcastToUser(userID string, eventType string, data any) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	ev := Event{Type: eventType, Data: data}
	for c := range h.clients {
		if c.userID == userID {
			select {
			case c.ch <- ev:
			default:
			}
		}
	}
}

// ServeSSE handles an SSE connection. The request must already be authenticated;
// pass userID="" for unauthenticated streams (not recommended for production).
func (h *Hub) ServeSSE(userID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Verify client supports streaming
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

		c := &client{
			ch:     make(chan Event, 32),
			userID: userID,
		}

		h.mu.Lock()
		h.clients[c] = struct{}{}
		h.mu.Unlock()

		defer func() {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			close(c.ch)
		}()

		// Send a connected ping so the client knows the stream is alive
		fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
		flusher.Flush()

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprintf(w, ": ping\n\n")
				flusher.Flush()
			case ev, ok := <-c.ch:
				if !ok {
					return
				}
				b, err := json.Marshal(ev.Data)
				if err != nil {
					log.Printf("[SSE] marshal error: %v", err)
					continue
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b)
				flusher.Flush()
			}
		}
	}
}

// ClientCount returns the number of active SSE connections.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
