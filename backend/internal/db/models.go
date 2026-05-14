package db

import "time"

// ─────────────────────────────────────────────────────────────
// Music library models
// ─────────────────────────────────────────────────────────────

type Artist struct {
	ID            string    `db:"id" json:"id"`
	Name          string    `db:"name" json:"name"`
	SortName      string    `db:"sort_name" json:"sort_name"`
	MusicBrainzID string    `db:"musicbrainz_id" json:"musicbrainz_id"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time `db:"updated_at" json:"updated_at"`
}

type Album struct {
	ID            string    `db:"id" json:"id"`
	ArtistID      string    `db:"artist_id" json:"artist_id"`
	AlbumArtistID string    `db:"album_artist_id" json:"album_artist_id"`
	Title         string    `db:"title" json:"title"`
	Year          int       `db:"year" json:"year"`
	Genre         string    `db:"genre" json:"genre"`
	SourceType    string    `db:"source_type" json:"source_type"` // local | subsonic
	SourceID      string    `db:"source_id" json:"source_id"`
	CoverArtID    *string   `db:"cover_art_id" json:"cover_art_id"`
	CoverStatus   string    `db:"cover_status" json:"cover_status"` // found | missing | generated | error
	TrackCount    int       `db:"track_count" json:"track_count"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time `db:"updated_at" json:"updated_at"`
}

type Track struct {
	ID          string    `db:"id" json:"id"`
	AlbumID     string    `db:"album_id" json:"album_id"`
	ArtistID    string    `db:"artist_id" json:"artist_id"`
	Title       string    `db:"title" json:"title"`
	Artist      string    `db:"artist" json:"artist"`
	Album       string    `db:"album" json:"album"`
	TrackNumber int       `db:"track_number" json:"track_number"`
	DiscNumber  int       `db:"disc_number" json:"disc_number"`
	Duration    int       `db:"duration" json:"duration_secs"`
	FilePath    string    `db:"file_path" json:"file_path"`
	SourceType  string    `db:"source_type" json:"source_type"` // local | subsonic
	SourceID    string    `db:"source_id" json:"source_id"`
	StreamURL   string    `db:"stream_url" json:"stream_url"`
	CoverArtID  *string   `db:"cover_art_id" json:"cover_art_id"`
	BPM         int       `db:"bpm"          json:"bpm"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
}

type AlbumArt struct {
	ID               string    `db:"id"`
	AlbumID          string    `db:"album_id"`
	TrackID          string    `db:"track_id"`
	SourceType       string    `db:"source_type"` // embedded | folder_file | subsonic | generated | external
	SourcePath       string    `db:"source_path"`
	OriginalHash     string    `db:"original_hash"`
	MimeType         string    `db:"mime_type"`
	Width            int       `db:"width"`
	Height           int       `db:"height"`
	SmallPath        string    `db:"small_path"`  // 128x128
	MediumPath       string    `db:"medium_path"` // 300x300
	LargePath        string    `db:"large_path"`  // 600x600
	ColorPaletteJSON string    `db:"color_palette_json"`
	CreatedAt        time.Time `db:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"`
}

type Playlist struct {
	ID              string    `db:"id"`
	Name            string    `db:"name"`
	SourceType      string    `db:"source_type"` // local | subsonic
	SourceID        string    `db:"source_id"`
	IsPartyPlaylist bool      `db:"is_party_playlist"`
	IntroTrackID    *string   `db:"intro_track_id"`
	CreatedAt       time.Time `db:"created_at"`
}

type PlaylistTrack struct {
	PlaylistID string `db:"playlist_id"`
	TrackID    string `db:"track_id"`
	Position   int    `db:"position"`
}

// ─────────────────────────────────────────────────────────────
// Users & Access models
// ─────────────────────────────────────────────────────────────

type User struct {
	ID               string     `db:"id"`
	DisplayName      string     `db:"display_name"`
	Username         string     `db:"username"`
	Email            string     `db:"email"`
	Role             string     `db:"role"` // admin | user
	PinHash          string     `db:"pin_hash"`
	LoginTokenHash   string     `db:"login_token_hash"`
	IsActive         bool       `db:"is_active"`
	IsPermanent      bool       `db:"is_permanent"`
	AccessStartsAt   *time.Time `db:"access_starts_at"`
	AccessExpiresAt  *time.Time `db:"access_expires_at"`
	CreatedByAdminID *string    `db:"created_by_admin_id"`
	CreatedAt        time.Time  `db:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at"`
	LastSeenAt       *time.Time `db:"last_seen_at"`
	ForcePinChange   bool       `db:"force_pin_change"`
}

type Session struct {
	ID               string     `db:"id"`
	UserID           string     `db:"user_id"`
	SessionTokenHash string     `db:"session_token_hash"`
	DeviceName       string     `db:"device_name"`
	UserAgent        string     `db:"user_agent"`
	IPAddress        string     `db:"ip_address"`
	IsGuestSession   bool       `db:"is_guest_session"`
	CreatedAt        time.Time  `db:"created_at"`
	ExpiresAt        time.Time  `db:"expires_at"`
	RevokedAt        *time.Time `db:"revoked_at"`
	LastSeenAt       time.Time  `db:"last_seen_at"`
}

type UserPermissions struct {
	UserID            string `db:"user_id"             json:"user_id"`
	CanAddToQueue     bool   `db:"can_add_to_queue"    json:"can_add_to_queue"`
	CanSearch         bool   `db:"can_search"          json:"can_search"`
	CanUsePartyButton bool   `db:"can_use_party_button" json:"can_use_party_button"`
	CanViewQueue      bool   `db:"can_view_queue"      json:"can_view_queue"`
}

type AccessLink struct {
	ID        string     `db:"id"`
	UserID    string     `db:"user_id"`
	TokenHash string     `db:"token_hash"`
	CreatedAt time.Time  `db:"created_at"`
	ExpiresAt *time.Time `db:"expires_at"`
	UsedAt    *time.Time `db:"used_at"`
	RevokedAt *time.Time `db:"revoked_at"`
}

// ─────────────────────────────────────────────────────────────
// Playback models
// ─────────────────────────────────────────────────────────────

type QueueItem struct {
	ID          string    `db:"id"`
	RoomID      string    `db:"room_id"`
	TrackID     string    `db:"track_id"`
	AddedByUser string    `db:"added_by_user_id"`
	Position    int       `db:"position"`
	IsAutoplay  bool      `db:"is_autoplay"`
	AddedAt     time.Time `db:"added_at"`
}

// QueueItemRich is returned by the API and includes denormalized track data.
type QueueItemRich struct {
	ID           string    `db:"id"                  json:"id"`
	TrackID      string    `db:"track_id"            json:"track_id"`
	TrackTitle   string    `db:"track_title"         json:"track_title"`
	TrackArtist  string    `db:"track_artist"        json:"track_artist"`
	TrackAlbum   string    `db:"track_album"         json:"track_album"`
	DurationSecs int       `db:"duration_secs"       json:"duration_secs"`
	TrackBPM     int       `db:"track_bpm"           json:"track_bpm"`
	CoverArtID   string    `db:"album_cover_art_id"  json:"album_cover_art_id"`
	AddedByUser  string    `db:"added_by_user_id"    json:"added_by_user_id"`
	Position     int       `db:"position"            json:"position"`
	IsAutoplay   bool      `db:"is_autoplay"         json:"is_autoplay"`
	AddedAt      time.Time `db:"added_at"            json:"added_at"`
}

type PlaybackHistory struct {
	ID           string     `db:"id"`
	TrackID      string     `db:"track_id"`
	PlayedByUser string     `db:"played_by_user_id"`
	StartedAt    time.Time  `db:"started_at"`
	EndedAt      *time.Time `db:"ended_at"`
	WasSkipped   bool       `db:"was_skipped"`
	WasParty     bool       `db:"was_party"`
}

type PlaybackState struct {
	ID             int       `db:"id"`
	CurrentTrackID string    `db:"current_track_id"`
	IsPlaying      bool      `db:"is_playing"`
	IsPartyMode    bool      `db:"is_party_mode"`
	PartyTrackID   string    `db:"party_track_id"`
	PositionSecs   float64   `db:"position_seconds"`
	UpdatedAt      time.Time `db:"updated_at"`
}

// RoomPlaybackState stores per-room playback state (one row per room).
type RoomPlaybackState struct {
	RoomID          string    `db:"room_id"`
	CurrentTrackID  string    `db:"current_track_id"`
	IsPlaying       bool      `db:"is_playing"`
	IsPartyMode     bool      `db:"is_party_mode"`
	IsAutoplayTrack bool      `db:"is_autoplay_track"`
	PartyTrackID    string    `db:"party_track_id"`
	PositionSecs    float64   `db:"position_seconds"`
	UpdatedAt       time.Time `db:"updated_at"`
}

// ─────────────────────────────────────────────────────────────
// Room models
// ─────────────────────────────────────────────────────────────

type Room struct {
	ID                    string  `db:"id"                       json:"id"`
	Name                  string  `db:"name"                     json:"name"`
	OwnerUserID           *string `db:"owner_user_id"            json:"owner_user_id,omitempty"`
	PartyPlaylistID       *string `db:"party_playlist_id"        json:"party_playlist_id,omitempty"`
	ActivePlayerSessionID *string `db:"active_player_session_id" json:"active_player_session_id,omitempty"`
	Volume                int     `db:"volume"                   json:"volume"`
	Balance               int     `db:"balance"                  json:"balance"`
	ToneBass              int     `db:"tone_bass"                json:"tone_bass"`
	ToneMid               int     `db:"tone_mid"                 json:"tone_mid"`
	ToneTreble            int     `db:"tone_treble"              json:"tone_treble"`
	IsMuted               bool    `db:"is_muted"                 json:"is_muted"`
	Loudness              bool    `db:"loudness"                 json:"loudness"`
	// Auto DJ settings (migration 015)
	AutoDjEnabled         bool      `db:"auto_dj_enabled"          json:"auto_dj_enabled"`
	CrossfadeSeconds      int       `db:"crossfade_seconds"        json:"crossfade_seconds"`
	TempoMatchEnabled     bool      `db:"tempo_match_enabled"      json:"tempo_match_enabled"`
	MaxTempoAdjustPercent int       `db:"max_tempo_adjust_percent" json:"max_tempo_adjust_percent"`
	CreatedAt             time.Time `db:"created_at"               json:"created_at"`
	UpdatedAt             time.Time `db:"updated_at"               json:"updated_at"`
}

// ─────────────────────────────────────────────────────────────
// Settings models
// ─────────────────────────────────────────────────────────────

type Setting struct {
	Key       string    `db:"key"`
	Value     string    `db:"value"`
	UpdatedAt time.Time `db:"updated_at"`
}

type KeyboardBinding struct {
	Action  string `db:"action"  json:"action"`
	KeyCode string `db:"key_code" json:"key_code"`
	Label   string `db:"label"   json:"label"`
}

type SubsonicConfig struct {
	ID           int        `db:"id"`
	URL          string     `db:"url"`
	Username     string     `db:"username"`
	PasswordHash string     `db:"password_hash"`
	APIToken     string     `db:"api_token"`
	IsEnabled    bool       `db:"is_enabled"`
	LastSyncAt   *time.Time `db:"last_sync_at"`
}
