package queue

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
)

// Manager handles the play queue for a single room.
type Manager struct {
	db     *sqlx.DB
	roomID string
}

func NewManager(database *sqlx.DB, roomID string) *Manager {
	return &Manager{db: database, roomID: roomID}
}

// GetQueue returns the current queue in position order with joined track info.
func (m *Manager) GetQueue(ctx context.Context) ([]db.QueueItemRich, error) {
	var items []db.QueueItemRich
	err := m.db.SelectContext(ctx, &items, `
		SELECT
			qi.id,
			qi.track_id,
			COALESCE(qi.added_by_user_id, '') AS added_by_user_id,
			qi.position,
			qi.is_autoplay,
			qi.added_at,
			t.title                                     AS track_title,
			ar.name                                     AS track_artist,
			al.title                                    AS track_album,
			t.duration                                  AS duration_secs,
			t.bpm                                       AS track_bpm,
			COALESCE(t.cover_art_id, al.cover_art_id, '') AS album_cover_art_id
		FROM queue_items qi
		JOIN tracks  t  ON t.id  = qi.track_id
		JOIN albums  al ON al.id = t.album_id
		JOIN artists ar ON ar.id = t.artist_id
		WHERE qi.room_id = ?
		ORDER BY qi.position ASC`, m.roomID)
	return items, err
}

// AddTrack appends a track to the end of the queue.
func (m *Manager) AddTrack(ctx context.Context, trackID, userID string) (*db.QueueItem, error) {
	// Validate track exists and is not a SKÅL-only upload
	var track db.Track
	if err := m.db.GetContext(ctx, &track, `SELECT id, source_type FROM tracks WHERE id = ?`, trackID); err != nil {
		return nil, fmt.Errorf("track not found: %s", trackID)
	}
	if track.SourceType == "party_upload" {
		return nil, fmt.Errorf("SKÅL-numre kan kun afspilles via SKÅL-knappen")
	}

	// Prevent duplicates: a track can only appear once in the queue at a time (non-autoplay only)
	var existing int
	_ = m.db.GetContext(ctx, &existing, `SELECT COUNT(*) FROM queue_items WHERE room_id = ? AND track_id = ? AND is_autoplay = 0`, m.roomID, trackID)
	if existing > 0 {
		return nil, fmt.Errorf("track is already in the queue")
	}

	// Get next position for this room
	var maxPos int
	_ = m.db.GetContext(ctx, &maxPos, `SELECT COALESCE(MAX(position), 0) FROM queue_items WHERE room_id = ?`, m.roomID)

	item := &db.QueueItem{
		ID:          uuid.NewString(),
		RoomID:      m.roomID,
		TrackID:     trackID,
		AddedByUser: userID,
		Position:    maxPos + 1,
		IsAutoplay:  false,
		AddedAt:     time.Now(),
	}

	_, err := m.db.ExecContext(ctx, `
		INSERT INTO queue_items (id, room_id, track_id, added_by_user_id, position, is_autoplay, added_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.RoomID, item.TrackID, item.AddedByUser,
		item.Position, item.IsAutoplay, item.AddedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("add to queue: %w", err)
	}

	return item, nil
}

// RemoveItem removes a specific queue item (room-scoped for safety).
func (m *Manager) RemoveItem(ctx context.Context, itemID string) error {
	_, err := m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE id = ? AND room_id = ?`, itemID, m.roomID)
	return err
}

// Advance pops and returns the next item from the front of the room's queue.
// Returns nil if the queue is empty.
func (m *Manager) Advance(ctx context.Context) (*db.QueueItem, error) {
	var item db.QueueItem
	err := m.db.GetContext(ctx, &item,
		`SELECT * FROM queue_items WHERE room_id = ? ORDER BY position ASC LIMIT 1`, m.roomID)
	if err != nil {
		return nil, nil // empty queue
	}

	_, err = m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE id = ?`, item.ID)
	if err != nil {
		return nil, fmt.Errorf("remove queue item: %w", err)
	}

	// Re-number positions for this room
	_, _ = m.db.ExecContext(ctx, `
		UPDATE queue_items SET position = position - 1
		WHERE room_id = ? AND position > ?`, m.roomID, item.Position)

	return &item, nil
}

// Reorder updates queue item positions.
func (m *Manager) Reorder(ctx context.Context, orderedIDs []string) error {
	tx, err := m.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for i, id := range orderedIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE queue_items SET position = ? WHERE id = ? AND room_id = ?`, i+1, id, m.roomID); err != nil {
			return fmt.Errorf("reorder item %s: %w", id, err)
		}
	}
	return tx.Commit()
}

// AutoplayNext selects a track for autoplay based on the last hour of room history.
// When there is no history yet (new room / first login) it falls back to a completely
// random track so playback never stops unintentionally.
func (m *Manager) AutoplayNext(ctx context.Context) (*db.Track, error) {
	// Get genre distribution from last 60 minutes of this room's history
	var recentGenres []string
	_ = m.db.SelectContext(ctx, &recentGenres, `
		SELECT DISTINCT al.genre
		FROM playback_history ph
		JOIN tracks t ON t.id = ph.track_id
		JOIN albums al ON al.id = t.album_id
		WHERE ph.started_at > datetime('now', '-60 minutes')
		  AND ph.room_id = ?
		  AND al.genre != ''
		LIMIT 5`, m.roomID)

	// Get recently played track IDs in this room to avoid repetition
	var recentTrackIDs []string
	_ = m.db.SelectContext(ctx, &recentTrackIDs, `
		SELECT track_id FROM playback_history
		WHERE started_at > datetime('now', '-60 minutes')
		  AND room_id = ?`, m.roomID)

	var track db.Track

	// Try to find a matching genre track first
	if len(recentGenres) > 0 {
		genre := recentGenres[rand.Intn(len(recentGenres))]
		if len(recentTrackIDs) > 0 {
			query, args, err := sqlx.In(`
				SELECT t.* FROM tracks t
				JOIN albums al ON al.id = t.album_id
				WHERE al.genre = ? AND t.id NOT IN (?)
				ORDER BY RANDOM() LIMIT 1`, genre, recentTrackIDs)
			if err == nil {
				query = m.db.Rebind(query)
				if err := m.db.GetContext(ctx, &track, query, args...); err == nil {
					return &track, nil
				}
			}
		} else {
			if err := m.db.GetContext(ctx, &track, `
				SELECT t.* FROM tracks t
				JOIN albums al ON al.id = t.album_id
				WHERE al.genre = ?
				ORDER BY RANDOM() LIMIT 1`, genre); err == nil {
				return &track, nil
			}
		}
	}

	// Fall back: any track not recently played in this room
	if len(recentTrackIDs) > 0 {
		query, args, err := sqlx.In(`
			SELECT * FROM tracks WHERE id NOT IN (?)
			ORDER BY RANDOM() LIMIT 1`, recentTrackIDs)
		if err == nil {
			query = m.db.Rebind(query)
			if err := m.db.GetContext(ctx, &track, query, args...); err == nil {
				return &track, nil
			}
		}
	}

	// Absolute fallback: no history at all (first login, empty room) — pick any random track.
	var track2 db.Track
	if err := m.db.GetContext(ctx, &track2, `SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1`); err == nil {
		return &track2, nil
	}

	return nil, fmt.Errorf("no tracks in library")
}

// IsEmpty reports whether the room's queue has no items.
func (m *Manager) IsEmpty(ctx context.Context) bool {
	var count int
	_ = m.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM queue_items WHERE room_id = ?`, m.roomID)
	return count == 0
}

// ClearAutoplayItems removes all autoplay items from the queue for this room.
func (m *Manager) ClearAutoplayItems(ctx context.Context) error {
	_, err := m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE is_autoplay = 1 AND room_id = ?`, m.roomID)
	return err
}

// PeekNext returns the next track that will play without advancing the queue.
// If the queue is non-empty it returns the first item. If the queue is empty it
// calls AutoplayNext, pre-queues the result (is_autoplay=true) so that the
// upcoming TrackEnded → Advance path dequeues exactly the same track, and then
// returns it. Returns nil, nil when there is no next track (empty library, autoplay off).
func (m *Manager) PeekNext(ctx context.Context) (*db.QueueItemRich, error) {
	items, err := m.GetQueue(ctx)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		return &items[0], nil
	}

	// Queue is empty — check if an autoplay item is already pre-queued from a
	// previous PeekNext call (avoids pre-queuing duplicates).
	var preQueued int
	_ = m.db.GetContext(ctx, &preQueued, `SELECT COUNT(*) FROM queue_items WHERE room_id = ? AND is_autoplay = 1`, m.roomID)
	if preQueued > 0 {
		items, err = m.GetQueue(ctx)
		if err == nil && len(items) > 0 {
			return &items[0], nil
		}
		return nil, nil
	}

	// Pick the next autoplay track
	track, err := m.AutoplayNext(ctx)
	if err != nil || track == nil {
		return nil, nil
	}

	// Pre-queue it so TrackEnded → Advance will dequeue the same track
	var maxPos int
	_ = m.db.GetContext(ctx, &maxPos, `SELECT COALESCE(MAX(position), 0) FROM queue_items WHERE room_id = ?`, m.roomID)
	id := uuid.NewString()
	_, qErr := m.db.ExecContext(ctx, `
		INSERT INTO queue_items (id, room_id, track_id, added_by_user_id, position, is_autoplay, added_at)
		VALUES (?, ?, ?, NULL, ?, 1, ?)`,
		id, m.roomID, track.ID, maxPos+1, time.Now())
	if qErr != nil {
		// Could not pre-queue — return nil so the Auto DJ does NOT start a
		// crossfade to a track the backend won't play next (would cause a
		// display/audio mismatch where TrackEnded → Advance finds nothing and
		// AutoplayNext picks a different random track).
		return nil, nil
	}

	// Re-fetch the full rich item (with all joined fields)
	items, err = m.GetQueue(ctx)
	if err == nil && len(items) > 0 {
		return &items[0], nil
	}
	return nil, nil
}
