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

// Manager handles the play queue including autoplay logic.
type Manager struct {
	db *sqlx.DB
}

func NewManager(database *sqlx.DB) *Manager {
	return &Manager{db: database}
}

// GetQueue returns the current queue in position order with joined track info.
func (m *Manager) GetQueue(ctx context.Context) ([]db.QueueItemRich, error) {
	var items []db.QueueItemRich
	err := m.db.SelectContext(ctx, &items, `
		SELECT
			qi.id,
			qi.track_id,
			qi.added_by_user_id,
			qi.position,
			qi.is_autoplay,
			qi.added_at,
			t.title                                     AS track_title,
			ar.name                                     AS track_artist,
			al.title                                    AS track_album,
			t.duration                                  AS duration_secs,
			COALESCE(t.cover_art_id, al.cover_art_id, '') AS album_cover_art_id
		FROM queue_items qi
		JOIN tracks  t  ON t.id  = qi.track_id
		JOIN albums  al ON al.id = t.album_id
		JOIN artists ar ON ar.id = t.artist_id
		ORDER BY qi.position ASC`)
	return items, err
}

// AddTrack appends a track to the end of the queue.
func (m *Manager) AddTrack(ctx context.Context, trackID, userID string) (*db.QueueItem, error) {
	// Validate track exists
	var track db.Track
	if err := m.db.GetContext(ctx, &track, `SELECT id FROM tracks WHERE id = ?`, trackID); err != nil {
		return nil, fmt.Errorf("track not found: %s", trackID)
	}

	// Get next position
	var maxPos int
	_ = m.db.GetContext(ctx, &maxPos, `SELECT COALESCE(MAX(position), 0) FROM queue_items`)

	item := &db.QueueItem{
		ID:          uuid.NewString(),
		TrackID:     trackID,
		AddedByUser: userID,
		Position:    maxPos + 1,
		IsAutoplay:  false,
		AddedAt:     time.Now(),
	}

	_, err := m.db.ExecContext(ctx, `
		INSERT INTO queue_items (id, track_id, added_by_user_id, position, is_autoplay, added_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		item.ID, item.TrackID, item.AddedByUser,
		item.Position, item.IsAutoplay, item.AddedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("add to queue: %w", err)
	}

	// If autoplay was running, signal that a user track was added (caller handles this)
	return item, nil
}

// RemoveItem removes a specific queue item.
func (m *Manager) RemoveItem(ctx context.Context, itemID string) error {
	_, err := m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE id = ?`, itemID)
	return err
}

// Advance pops and returns the next item from the front of the queue.
// Returns nil if the queue is empty.
func (m *Manager) Advance(ctx context.Context) (*db.QueueItem, error) {
	var item db.QueueItem
	err := m.db.GetContext(ctx, &item,
		`SELECT * FROM queue_items ORDER BY position ASC LIMIT 1`)
	if err != nil {
		return nil, nil // empty queue
	}

	_, err = m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE id = ?`, item.ID)
	if err != nil {
		return nil, fmt.Errorf("remove queue item: %w", err)
	}

	// Re-number positions
	_, _ = m.db.ExecContext(ctx, `
		UPDATE queue_items SET position = position - 1
		WHERE position > ?`, item.Position)

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
		if _, err := tx.ExecContext(ctx, `UPDATE queue_items SET position = ? WHERE id = ?`, i+1, id); err != nil {
			return fmt.Errorf("reorder item %s: %w", id, err)
		}
	}
	return tx.Commit()
}

// AutoplayNext selects a track for autoplay based on recent history.
// It prefers tracks from genres/artists played in the last hour.
func (m *Manager) AutoplayNext(ctx context.Context) (*db.Track, error) {
	// Get genre distribution from last 60 minutes of history
	var recentGenres []string
	_ = m.db.SelectContext(ctx, &recentGenres, `
		SELECT DISTINCT al.genre
		FROM playback_history ph
		JOIN tracks t ON t.id = ph.track_id
		JOIN albums al ON al.id = t.album_id
		WHERE ph.started_at > datetime('now', '-60 minutes')
		  AND al.genre != ''
		LIMIT 5`)

	// Get recently played track IDs to avoid repetition
	var recentTrackIDs []string
	_ = m.db.SelectContext(ctx, &recentTrackIDs, `
		SELECT track_id FROM playback_history
		WHERE started_at > datetime('now', '-60 minutes')`)

	var track db.Track

	// Try to find a matching genre track first (use parameterized IN clause)
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

	// Fall back: any track not recently played
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

	// Last resort: truly random
	if err := m.db.GetContext(ctx, &track, `SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1`); err != nil {
		return nil, fmt.Errorf("no tracks available for autoplay")
	}
	return &track, nil
}

// IsEmpty reports whether the queue has no items.
func (m *Manager) IsEmpty(ctx context.Context) bool {
	var count int
	_ = m.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM queue_items`)
	return count == 0
}

// ClearAutoplayItems removes all autoplay items from the queue.
func (m *Manager) ClearAutoplayItems(ctx context.Context) error {
	_, err := m.db.ExecContext(ctx, `DELETE FROM queue_items WHERE is_autoplay = 1`)
	return err
}
