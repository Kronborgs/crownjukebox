package party

import (
	"context"
	"fmt"
	"math/rand"

	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
)

// Engine manages the SKÅLE (party/cheers) functionality for a single room.
type Engine struct {
	db     *sqlx.DB
	hub    *events.Hub
	roomID string
}

func NewEngine(database *sqlx.DB, hub *events.Hub, roomID string) *Engine {
	return &Engine{db: database, hub: hub, roomID: roomID}
}

// TriggerCheers picks a random track from this room's party playlist.
func (e *Engine) TriggerCheers(ctx context.Context, triggeredByUserID string) (*db.Track, error) {
	// Get party playlist ID from the rooms table
	var playlistID *string
	if err := e.db.GetContext(ctx, &playlistID,
		`SELECT party_playlist_id FROM rooms WHERE id = ?`, e.roomID); err != nil || playlistID == nil || *playlistID == "" {
		return nil, fmt.Errorf("ingen skåle-playliste konfigureret for dette rum — admin skal vælge en")
	}

	// Get all tracks in the party playlist
	var tracks []db.Track
	if err := e.db.SelectContext(ctx, &tracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, *playlistID); err != nil || len(tracks) == 0 {
		return nil, fmt.Errorf("skåle-playlisten er tom")
	}

	// Pick a random track
	track := tracks[rand.Intn(len(tracks))]

	// Build cover URL
	coverURL := ""
	if track.CoverArtID != nil && *track.CoverArtID != "" {
		coverURL = "/api/library/cover/" + *track.CoverArtID + "?size=large"
	}

	// Broadcast party started only to clients in this room
	e.hub.BroadcastToRoom(e.roomID, events.EventPartyStarted, map[string]any{
		"track":        track,
		"cover_url":    coverURL,
		"triggered_by": triggeredByUserID,
	})

	return &track, nil
}

// EndParty broadcasts party ended to this room.
func (e *Engine) EndParty(ctx context.Context) {
	e.hub.BroadcastToRoom(e.roomID, events.EventPartyEnded, map[string]any{})
}

// GetPartyPlaylist returns this room's configured party playlist.
func (e *Engine) GetPartyPlaylist(ctx context.Context) (*db.Playlist, []db.Track, error) {
	var playlistID *string
	if err := e.db.GetContext(ctx, &playlistID,
		`SELECT party_playlist_id FROM rooms WHERE id = ?`, e.roomID); err != nil || playlistID == nil || *playlistID == "" {
		return nil, nil, nil
	}

	var playlist db.Playlist
	if err := e.db.GetContext(ctx, &playlist, `SELECT * FROM playlists WHERE id = ?`, *playlistID); err != nil {
		return nil, nil, fmt.Errorf("playlist not found: %w", err)
	}

	var tracks []db.Track
	_ = e.db.SelectContext(ctx, &tracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, *playlistID)

	return &playlist, tracks, nil
}
