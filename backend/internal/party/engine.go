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

// BuildSequence builds the party track list and volume boost without any broadcast.
// It reads from the global party playlist (or room-specific if no global is set).
func (e *Engine) BuildSequence(ctx context.Context) (*PartySequence, error) {
	playlistID, err := e.getPartyPlaylistID(ctx)
	if err != nil || playlistID == nil || *playlistID == "" {
		return nil, fmt.Errorf("ingen skåle-playliste konfigureret — admin skal vælge en")
	}

	// Get intro tracks (ordered by position)
	var introTracks []db.Track
	if err := e.db.SelectContext(ctx, &introTracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ? AND pt.is_intro = 1
		ORDER BY pt.position`, *playlistID); err != nil {
		introTracks = nil
	}

	// Get non-intro tracks for random pick
	var extraTracks []db.Track
	if err := e.db.SelectContext(ctx, &extraTracks, `
		SELECT t.* FROM tracks t
		JOIN playlist_tracks pt ON pt.track_id = t.id
		WHERE pt.playlist_id = ? AND pt.is_intro = 0
		ORDER BY pt.position`, *playlistID); err != nil {
		extraTracks = nil
	}

	if len(introTracks) == 0 && len(extraTracks) == 0 {
		return nil, fmt.Errorf("skåle-playlisten er tom")
	}

	// Read volume boost setting
	var boostStr string
	_ = e.db.GetContext(ctx, &boostStr, `SELECT value FROM settings WHERE key = 'party_volume_boost' LIMIT 1`)
	boost := 15
	if n, err := strconv.Atoi(boostStr); err == nil && n >= 0 {
		boost = n
	}

	// Build sequence: all intros in order, then one random non-intro
	sequence := make([]db.Track, 0, len(introTracks)+1)
	sequence = append(sequence, introTracks...)
	if len(extraTracks) > 0 {
		sequence = append(sequence, extraTracks[rand.Intn(len(extraTracks))])
	} else if len(sequence) == 0 {
		sequence = append(sequence, introTracks[rand.Intn(len(introTracks))])
	}

	return &PartySequence{Tracks: sequence, VolumeBoost: boost}, nil
}

// TriggerCheers builds the party sequence:
// 1. All intro tracks (is_intro=1) in playlist position order
// 2. One random non-intro track from the remainder
// It broadcasts party_started and returns the full sequence.
func (e *Engine) TriggerCheers(ctx context.Context, triggeredByUserID string) (*PartySequence, error) {
	seq, err := e.BuildSequence(ctx)
	if err != nil {
		return nil, err
	}

	// Build cover URL for the first track (shown in overlay)
	firstTrack := seq.Tracks[0]
	coverURL := ""
	if firstTrack.CoverArtID != nil && *firstTrack.CoverArtID != "" {
		coverURL = "/api/library/cover/" + *firstTrack.CoverArtID + "?size=large"
	}

	// Broadcast party_started to all clients in this room
	e.hub.BroadcastToRoom(e.roomID, events.EventPartyStarted, map[string]any{
		"track":        firstTrack,
		"cover_url":    coverURL,
		"triggered_by": triggeredByUserID,
		"volume_boost": seq.VolumeBoost,
		"track_count":  len(seq.Tracks),
	})

	return seq, nil
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
