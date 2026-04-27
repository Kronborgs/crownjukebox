package party

import (
	"context"
	"fmt"
	"math/rand"
	"strconv"

	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
)

// PartySequence holds the ordered track list and volume boost for a Skål event.
type PartySequence struct {
	Tracks      []db.Track
	VolumeBoost int
}

// Engine manages the SKÅLE (party/cheers) functionality for a single room.
type Engine struct {
	db     *sqlx.DB
	hub    *events.Hub
	roomID string
}

func NewEngine(database *sqlx.DB, hub *events.Hub, roomID string) *Engine {
	return &Engine{db: database, hub: hub, roomID: roomID}
}

func (e *Engine) getPartyPlaylistID(ctx context.Context) (*string, error) {
	var globalPlaylistID string
	if err := e.db.GetContext(ctx, &globalPlaylistID, `SELECT value FROM settings WHERE key = 'party_playlist_id' LIMIT 1`); err == nil && globalPlaylistID != "" {
		return &globalPlaylistID, nil
	}

	var roomPlaylistID *string
	if err := e.db.GetContext(ctx, &roomPlaylistID, `SELECT party_playlist_id FROM rooms WHERE id = ?`, e.roomID); err != nil {
		return nil, err
	}
	return roomPlaylistID, nil
}

// TriggerCheers builds the party sequence:
// 1. Intro track (if one is marked on the playlist) — always first
// 2. One random non-intro track from the rest of the playlist
// It broadcasts party_started and returns the full sequence.
func (e *Engine) TriggerCheers(ctx context.Context, triggeredByUserID string) (*PartySequence, error) {
	playlistID, err := e.getPartyPlaylistID(ctx)
	if err != nil || playlistID == nil || *playlistID == "" {
		return nil, fmt.Errorf("ingen skåle-playliste konfigureret for dette rum — admin skal vælge en")
	}

	// Get intro_track_id for the playlist (may be nil)
	var introTrackID *string
	_ = e.db.GetContext(ctx, &introTrackID, `SELECT intro_track_id FROM playlists WHERE id = ?`, *playlistID)

	// Get all tracks in the party playlist
	var allTracks []db.Track
	if err := e.db.SelectContext(ctx, &allTracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.position`, *playlistID); err != nil || len(allTracks) == 0 {
		return nil, fmt.Errorf("skåle-playlisten er tom")
	}

	// Read volume boost setting
	var boostStr string
	_ = e.db.GetContext(ctx, &boostStr, `SELECT value FROM settings WHERE key = 'party_volume_boost' LIMIT 1`)
	boost := 15
	if n, err := strconv.Atoi(boostStr); err == nil && n >= 0 {
		boost = n
	}

	// Build sequence: intro first (if configured and in playlist), then one random extra
	var sequence []db.Track
	var extras []db.Track

	for _, t := range allTracks {
		if introTrackID != nil && t.ID == *introTrackID {
			sequence = append([]db.Track{t}, sequence...) // prepend intro
		} else {
			extras = append(extras, t)
		}
	}
	if len(extras) > 0 {
		sequence = append(sequence, extras[rand.Intn(len(extras))])
	}
	// Safety: if no intro was found, guarantee at least one track
	if len(sequence) == 0 {
		sequence = append(sequence, allTracks[rand.Intn(len(allTracks))])
	}

	// Build cover URL for the first track (shown in overlay)
	firstTrack := sequence[0]
	coverURL := ""
	if firstTrack.CoverArtID != nil && *firstTrack.CoverArtID != "" {
		coverURL = "/api/library/cover/" + *firstTrack.CoverArtID + "?size=large"
	}

	// Broadcast party_started to all clients in this room
	e.hub.BroadcastToRoom(e.roomID, events.EventPartyStarted, map[string]any{
		"track":        firstTrack,
		"cover_url":    coverURL,
		"triggered_by": triggeredByUserID,
		"volume_boost": boost,
		"track_count":  len(sequence),
	})

	return &PartySequence{Tracks: sequence, VolumeBoost: boost}, nil
}

// EndParty broadcasts party ended to this room.
func (e *Engine) EndParty(ctx context.Context) {
	e.hub.BroadcastToRoom(e.roomID, events.EventPartyEnded, map[string]any{})
}

// GetPartyPlaylist returns this room's configured party playlist.
func (e *Engine) GetPartyPlaylist(ctx context.Context) (*db.Playlist, []db.Track, error) {
	playlistID, err := e.getPartyPlaylistID(ctx)
	if err != nil || playlistID == nil || *playlistID == "" {
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

func NewEngine(database *sqlx.DB, hub *events.Hub, roomID string) *Engine {
	return &Engine{db: database, hub: hub, roomID: roomID}
}

func (e *Engine) getPartyPlaylistID(ctx context.Context) (*string, error) {
	var globalPlaylistID string
	if err := e.db.GetContext(ctx, &globalPlaylistID, `SELECT value FROM settings WHERE key = 'party_playlist_id' LIMIT 1`); err == nil && globalPlaylistID != "" {
		return &globalPlaylistID, nil
	}

	var roomPlaylistID *string
	if err := e.db.GetContext(ctx, &roomPlaylistID, `SELECT party_playlist_id FROM rooms WHERE id = ?`, e.roomID); err != nil {
		return nil, err
	}
	return roomPlaylistID, nil
}

// TriggerCheers picks a random track from this room's party playlist.
func (e *Engine) TriggerCheers(ctx context.Context, triggeredByUserID string) (*db.Track, error) {
	playlistID, err := e.getPartyPlaylistID(ctx)
	if err != nil || playlistID == nil || *playlistID == "" {
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
	playlistID, err := e.getPartyPlaylistID(ctx)
	if err != nil || playlistID == nil || *playlistID == "" {
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
