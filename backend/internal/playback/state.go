package playback

import (
	"context"
	"fmt"
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
	PositionSecs float64   `json:"position_seconds"`
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

	currentTrackID string
	isPlaying      bool
	isPartyMode    bool
	partyTrackID   string
	positionSecs   float64
	updatedAt      time.Time
	historyID      string
}

func NewManager(database *sqlx.DB, hub *events.Hub, qMgr *queue.Manager, partyEng PartyEnder) *Manager {
	m := &Manager{
		db:       database,
		hub:      hub,
		queueMgr: qMgr,
		partyEng: partyEng,
	}
	// Load persisted state
	m.loadState()
	return m
}

func (m *Manager) loadState() {
	var state db.PlaybackState
	if err := m.db.Get(&state, `SELECT * FROM playback_state WHERE id = 1`); err == nil {
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
		UPDATE playback_state
		SET current_track_id=?, is_playing=?, is_party_mode=?, party_track_id=?,
		    position_seconds=?, updated_at=?
		WHERE id=1`,
		m.currentTrackID, m.isPlaying, m.isPartyMode, m.partyTrackID,
		m.positionSecs, time.Now(),
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
		if err := m.db.GetContext(ctx, &t, `SELECT * FROM tracks WHERE id = ?`, m.currentTrackID); err == nil {
			state.CurrentTrack = &t
		}
	}

	var qLen int
	_ = m.db.GetContext(ctx, &qLen, `SELECT COUNT(*) FROM queue_items`)
	state.QueueLength = qLen

	return state, nil
}

// Play marks playback as active and optionally sets a new current track.
// If trackID is empty, it advances from the queue.
func (m *Manager) Play(ctx context.Context, trackID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if trackID == "" {
		// Advance from queue
		item, err := m.queueMgr.Advance(ctx)
		if err != nil {
			return err
		}
		if item == nil {
			// Queue empty — autoplay
			track, err := m.queueMgr.AutoplayNext(ctx)
			if err != nil {
				return fmt.Errorf("queue empty and no autoplay tracks: %w", err)
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
		INSERT INTO playback_history (id, track_id, played_by_user_id, started_at)
		VALUES (?, ?, ?, ?)`,
		m.historyID, trackID, userID, time.Now(),
	)

	m.saveState()

	// Fetch track info for SSE
	var t db.Track
	_ = m.db.GetContext(ctx, &t, `SELECT * FROM tracks WHERE id = ?`, trackID)

	m.hub.Broadcast(events.EventNowPlayingChanged, map[string]any{
		"track":     t,
		"cover_url": "/api/library/cover/" + t.CoverArtID + "?size=large",
	})
	m.hub.Broadcast(events.EventPlaybackStateChanged, map[string]any{
		"is_playing": true,
		"track_id":   trackID,
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

	m.hub.Broadcast(events.EventPlaybackStateChanged, map[string]any{
		"is_playing":   m.isPlaying,
		"position_sec": m.positionSecs,
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
	defer m.mu.Unlock()

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
