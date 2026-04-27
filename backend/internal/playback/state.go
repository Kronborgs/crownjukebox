package playback

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
	"github.com/crownjukebox/crownjukebox/internal/queue"
)

// PartyEnder is implemented by party.Engine to signal that a party song is done.
type PartyEnder interface {
	EndParty(ctx context.Context)
}

// State represents the current playback state returned to clients.
type State struct {
	IsPlaying    bool      `json:"is_playing"`
	IsPartyMode  bool      `json:"is_party_mode"`
	CurrentTrack *db.Track `json:"current_track,omitempty"`
	PositionSecs float64   `json:"position_secs"`
	QueueLength  int       `json:"queue_length"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Manager coordinates playback state and history.
type Manager struct {
	mu       sync.RWMutex
	db       *sqlx.DB
	hub      *events.Hub
	queueMgr *queue.Manager
	partyEng PartyEnder
	roomID   string

	currentTrackID string
	isPlaying      bool
	isPartyMode    bool
	partyTrackID   string
	positionSecs   float64
	updatedAt      time.Time
	historyID      string
}

func NewManager(database *sqlx.DB, hub *events.Hub, qMgr *queue.Manager, partyEng PartyEnder, roomID string) *Manager {
	m := &Manager{
		db:       database,
		hub:      hub,
		queueMgr: qMgr,
		partyEng: partyEng,
		roomID:   roomID,
	}
	// Load persisted state
	m.loadState()
	return m
}

func (m *Manager) loadState() {
	var state db.RoomPlaybackState
	if err := m.db.Get(&state, `SELECT * FROM room_playback_state WHERE room_id = ?`, m.roomID); err == nil {
		m.currentTrackID = state.CurrentTrackID
		m.isPlaying = state.IsPlaying
		m.isPartyMode = state.IsPartyMode
		m.partyTrackID = state.PartyTrackID
		m.positionSecs = state.PositionSecs
		m.updatedAt = state.UpdatedAt
	}
}

func (m *Manager) saveState() {
	_, _ = m.db.Exec(`
		INSERT INTO room_playback_state
			(room_id, current_track_id, is_playing, is_party_mode, party_track_id, position_seconds, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(room_id) DO UPDATE SET
			current_track_id = excluded.current_track_id,
			is_playing       = excluded.is_playing,
			is_party_mode    = excluded.is_party_mode,
			party_track_id   = excluded.party_track_id,
			position_seconds = excluded.position_seconds,
			updated_at       = excluded.updated_at`,
		m.roomID, m.currentTrackID, m.isPlaying, m.isPartyMode,
		m.partyTrackID, m.positionSecs, time.Now(),
	)
}

// GetState returns the current playback state.
func (m *Manager) GetState(ctx context.Context) (*State, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	state := &State{
		IsPlaying:    m.isPlaying,
		IsPartyMode:  m.isPartyMode,
		PositionSecs: m.positionSecs,
		UpdatedAt:    m.updatedAt,
	}

	if m.currentTrackID != "" {
		var t db.Track
		if err := m.db.GetContext(ctx, &t, `
			SELECT
				t.*,
				COALESCE(ar.name, '') AS artist,
				COALESCE(al.title, '') AS album,
				COALESCE(t.cover_art_id, al.cover_art_id) AS cover_art_id
			FROM tracks t
			LEFT JOIN artists ar ON ar.id = t.artist_id
			LEFT JOIN albums al ON al.id = t.album_id
			WHERE t.id = ?`, m.currentTrackID); err == nil {
			state.CurrentTrack = &t
		}
	}

	var qLen int
	_ = m.db.GetContext(ctx, &qLen, `SELECT COUNT(*) FROM queue_items WHERE room_id = ?`, m.roomID)
	state.QueueLength = qLen

	return state, nil
}

// Play marks playback as active and optionally sets a new current track.
// If trackID is empty, it advances from the queue.
func (m *Manager) Play(ctx context.Context, trackID, userID string) error {
	m.mu.Lock()

	if trackID == "" {
		// Advance from queue
		item, err := m.queueMgr.Advance(ctx)
		if err != nil {
			m.mu.Unlock()
			return err
		}
		if item == nil {
			// Queue empty — check if autoplay is enabled before selecting a random track
			var autoplayEnabled string
			_ = m.db.GetContext(ctx, &autoplayEnabled, `SELECT value FROM settings WHERE key = 'autoplay_enabled' LIMIT 1`)
			if autoplayEnabled != "true" && autoplayEnabled != "1" {
				// Autoplay disabled: stop playback gracefully
				m.isPlaying = false
				m.currentTrackID = ""
				m.updatedAt = time.Now()
				m.saveState()
				m.mu.Unlock()
				m.hub.BroadcastToRoom(m.roomID, events.EventPlaybackStateChanged, map[string]any{
					"is_playing":    false,
					"position_secs": 0,
				})
				return nil
			}
			// Autoplay enabled — pick based on last hour of history in this room
			track, err := m.queueMgr.AutoplayNext(ctx)
			if err != nil {
				// No autoplay candidates (empty library or not enough history) — stop
				m.isPlaying = false
				m.currentTrackID = ""
				m.updatedAt = time.Now()
				m.saveState()
				m.mu.Unlock()
				m.hub.BroadcastToRoom(m.roomID, events.EventPlaybackStateChanged, map[string]any{
					"is_playing":    false,
					"position_secs": 0,
				})
				return nil
			}
			trackID = track.ID
		} else {
			trackID = item.TrackID
		}
	}

	// Record history
	m.endCurrentHistory(ctx)

	m.currentTrackID = trackID
	m.isPlaying = true
	m.positionSecs = 0
	m.updatedAt = time.Now()

	// Start new history entry
	m.historyID = uuid.NewString()
	_, _ = m.db.ExecContext(ctx, `
		INSERT INTO playback_history (id, room_id, track_id, played_by_user_id, started_at)
		VALUES (?, ?, ?, ?, ?)`,
		m.historyID, m.roomID, trackID, userID, time.Now(),
	)

	m.saveState()
	m.mu.Unlock() // Release lock BEFORE calling GetState (which also acquires a read lock)

	// Fetch track info for SSE — must not hold m.mu here
	state, _ := m.GetState(ctx)
	m.hub.BroadcastToRoom(m.roomID, events.EventNowPlayingChanged, state)
	m.hub.BroadcastToRoom(m.roomID, events.EventPlaybackStateChanged, map[string]any{
		"is_playing":    true,
		"position_secs": 0,
	})

	return nil
}

// Pause toggles the playing state.
func (m *Manager) Pause(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.isPlaying = !m.isPlaying
	m.updatedAt = time.Now()
	m.saveState()

	m.hub.BroadcastToRoom(m.roomID, events.EventPlaybackStateChanged, map[string]any{
		"is_playing":    m.isPlaying,
		"position_secs": m.positionSecs,
	})
	return nil
}

// UpdatePosition is called by the client to report current playback position.
func (m *Manager) UpdatePosition(ctx context.Context, positionSecs float64, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.positionSecs = positionSecs
	m.updatedAt = time.Now()
	m.saveState()
}

// Skip forcibly moves to the next track (admin or party mode only).
func (m *Manager) Skip(ctx context.Context, userID string, wasSkipped bool) error {
	m.mu.Lock()
	m.endCurrentHistoryLocked(ctx, wasSkipped)
	m.mu.Unlock()

	return m.Play(ctx, "", userID)
}

// TrackEnded is called when the client reports the current track finished naturally.
func (m *Manager) TrackEnded(ctx context.Context, trackID, userID string) error {
	m.mu.Lock()
	wasParty := m.isPartyMode && m.partyTrackID == trackID
	if wasParty {
		m.isPartyMode = false
		m.partyTrackID = ""
	}
	m.endCurrentHistoryLocked(ctx, false)
	m.mu.Unlock()

	if wasParty && m.partyEng != nil {
		m.partyEng.EndParty(ctx)
	}

	log.Printf("[playback] track ended: %s (party=%v)", trackID, wasParty)

	// Try to advance to next in queue
	return m.Play(ctx, "", userID)
}

func (m *Manager) endCurrentHistory(ctx context.Context) {
	m.endCurrentHistoryLocked(ctx, false)
}

func (m *Manager) endCurrentHistoryLocked(ctx context.Context, wasSkipped bool) {
	if m.historyID != "" {
		_, _ = m.db.ExecContext(ctx, `
			UPDATE playback_history
			SET ended_at = ?, was_skipped = ?
			WHERE id = ?`,
			time.Now(), wasSkipped, m.historyID,
		)
		m.historyID = ""
	}
}

// SetPartyMode toggles party (skåle) mode state.
func (m *Manager) SetPartyMode(on bool, partyTrackID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.isPartyMode = on
	m.partyTrackID = partyTrackID
	m.saveState()
}
