package party

import (
	"context"
	"fmt"
	"math/rand"

	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
)

// Engine manages the SKÅLE (party/cheers) functionality.
type Engine struct {
	db  *sqlx.DB
	hub *events.Hub
}

func NewEngine(database *sqlx.DB, hub *events.Hub) *Engine {
	return &Engine{db: database, hub: hub}
}

// TriggerCheers picks a random track from the party playlist and broadcasts the party start event.
// Returns the selected track, or error if no party playlist is configured.
func (e *Engine) TriggerCheers(ctx context.Context, triggeredByUserID string) (*db.Track, error) {
	// Get party playlist ID from settings
	var playlistID string
	if err := e.db.GetContext(ctx, &playlistID,
		`SELECT value FROM settings WHERE key = 'party_playlist_id'`); err != nil || playlistID == "" {
		return nil, fmt.Errorf("ingen skåle-playliste konfigureret — admin skal vælge en")
	}

	// Get all tracks in the party playlist
	var tracks []db.Track
	if err := e.db.SelectContext(ctx, &tracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, playlistID); err != nil || len(tracks) == 0 {
		return nil, fmt.Errorf("skåle-playlisten er tom")
	}

	// Pick a random track
	track := tracks[rand.Intn(len(tracks))]

	// Build cover URL
	coverURL := ""
	if track.CoverArtID != "" {
		coverURL = "/api/library/cover/" + track.CoverArtID + "?size=large"
	}

	// Broadcast party started to all connected clients
	e.hub.Broadcast(events.EventPartyStarted, map[string]any{
		"track":        track,
		"cover_url":    coverURL,
		"triggered_by": triggeredByUserID,
	})

	return &track, nil
}

// EndParty broadcasts party ended and returns to normal playback.
func (e *Engine) EndParty(ctx context.Context) {
	e.hub.Broadcast(events.EventPartyEnded, map[string]any{})
}

// GetPartyPlaylist returns the configured party playlist.
func (e *Engine) GetPartyPlaylist(ctx context.Context) (*db.Playlist, []db.Track, error) {
	var playlistID string
	if err := e.db.GetContext(ctx, &playlistID,
		`SELECT value FROM settings WHERE key = 'party_playlist_id'`); err != nil || playlistID == "" {
		return nil, nil, nil
	}

	var playlist db.Playlist
	if err := e.db.GetContext(ctx, &playlist, `SELECT * FROM playlists WHERE id = ?`, playlistID); err != nil {
		return nil, nil, fmt.Errorf("playlist not found: %w", err)
	}

	var tracks []db.Track
	_ = e.db.SelectContext(ctx, &tracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, playlistID)

	return &playlist, tracks, nil
}

// SetPartyPlaylist sets the party playlist in settings.
func (e *Engine) SetPartyPlaylist(ctx context.Context, playlistID string) error {
	_, err := e.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO settings (key, value, updated_at)
		VALUES ('party_playlist_id', ?, CURRENT_TIMESTAMP)`, playlistID)
	return err
}
