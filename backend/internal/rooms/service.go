package rooms

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
	"github.com/crownjukebox/crownjukebox/internal/events"
	"github.com/crownjukebox/crownjukebox/internal/party"
	"github.com/crownjukebox/crownjukebox/internal/playback"
	"github.com/crownjukebox/crownjukebox/internal/queue"
)

// Room bundles the runtime state for a single party room.
type Room struct {
	Info     db.Room
	Queue    *queue.Manager
	Playback *playback.Manager
	Party    *party.Engine
}

// Service manages the set of active rooms and creates them on demand.
type Service struct {
	mu    sync.RWMutex
	db    *sqlx.DB
	hub   *events.Hub
	rooms map[string]*Room
}

// New creates a new RoomService. It does NOT pre-load rooms; they are loaded lazily.
func New(database *sqlx.DB, hub *events.Hub) *Service {
	return &Service{
		db:    database,
		hub:   hub,
		rooms: make(map[string]*Room),
	}
}

// Get returns the runtime Room for the given ID, creating it lazily if needed.
// Returns nil if the room does not exist in the database.
func (s *Service) Get(ctx context.Context, roomID string) *Room {
	s.mu.RLock()
	if r, ok := s.rooms[roomID]; ok {
		s.mu.RUnlock()
		return r
	}
	s.mu.RUnlock()

	// Not cached yet — load from DB.
	var info db.Room
	if err := s.db.GetContext(ctx, &info, `SELECT * FROM rooms WHERE id = ?`, roomID); err != nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Double-check after acquiring write lock.
	if r, ok := s.rooms[roomID]; ok {
		return r
	}

	r := s.buildRoom(info)
	s.rooms[roomID] = r
	return r
}

// GetDefault returns the default room, creating it if it doesn't exist yet.
func (s *Service) GetDefault(ctx context.Context) *Room {
	return s.Get(ctx, "default")
}

// List returns all rooms from the database.
func (s *Service) List(ctx context.Context) ([]db.Room, error) {
	var rooms []db.Room
	err := s.db.SelectContext(ctx, &rooms, `SELECT * FROM rooms ORDER BY created_at ASC`)
	return rooms, err
}

// Create creates a new room and returns it.
func (s *Service) Create(ctx context.Context, name string) (*db.Room, error) {
	info := db.Room{
		ID:        uuid.NewString(),
		Name:      name,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		info.ID, info.Name, info.CreatedAt, info.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.rooms[info.ID] = s.buildRoom(info)
	s.mu.Unlock()

	return &info, nil
}

// CreateForUser creates a personal room for a user (room_id = user_id).
// If the room already exists in DB, it loads and returns it.
func (s *Service) CreateForUser(ctx context.Context, userID, displayName string) *Room {
	// Check if room already exists in DB
	var existing db.Room
	err := s.db.GetContext(ctx, &existing, `SELECT * FROM rooms WHERE id = ?`, userID)
	if err == nil {
		// Room exists, build and cache it
		s.mu.Lock()
		defer s.mu.Unlock()
		if r, ok := s.rooms[userID]; ok {
			return r
		}
		r := s.buildRoom(existing)
		s.rooms[userID] = r
		return r
	}

	// Create new room for user
	info := db.Room{
		ID:          userID, // room_id = user_id
		Name:        displayName + "s Jukebox",
		OwnerUserID: &userID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO rooms (id, name, owner_user_id, created_at, updated_at) 
		VALUES (?, ?, ?, ?, ?)`,
		info.ID, info.Name, info.OwnerUserID, info.CreatedAt, info.UpdatedAt,
	)
	if err != nil {
		// If insert fails (race condition), try to load it
		if r := s.Get(ctx, userID); r != nil {
			return r
		}
		return nil
	}

	// Create initial playback state for the room
	_, _ = s.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO room_playback_state (room_id, is_playing, position_seconds, updated_at)
		VALUES (?, 0, 0, CURRENT_TIMESTAMP)`, userID)

	s.mu.Lock()
	r := s.buildRoom(info)
	s.rooms[info.ID] = r
	s.mu.Unlock()

	return r
}

// Delete removes a room and its associated runtime state.
func (s *Service) Delete(ctx context.Context, roomID string) error {
	if roomID == "default" {
		return nil // cannot delete the default room
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM rooms WHERE id = ?`, roomID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.rooms, roomID)
	s.mu.Unlock()
	return nil
}

// SetPartyPlaylist updates the party playlist for a room.
func (s *Service) SetPartyPlaylist(ctx context.Context, roomID, playlistID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE rooms SET party_playlist_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		playlistID, roomID)
	if err != nil {
		return err
	}
	// Invalidate cached room so it reloads
	s.mu.Lock()
	delete(s.rooms, roomID)
	s.mu.Unlock()
	return nil
}

// buildRoom constructs the runtime Room from a db.Room record.
// Must be called with no locks held (or under write lock).
func (s *Service) buildRoom(info db.Room) *Room {
	partyEng := party.NewEngine(s.db, s.hub, info.ID)
	qMgr := queue.NewManager(s.db, info.ID)
	pbMgr := playback.NewManager(s.db, s.hub, qMgr, partyEng, info.ID)
	go func() {
		// Give the room a moment to fully initialise before attempting autoplay.
		// The library scan runs in the background so tracks should be available.
		time.Sleep(3 * time.Second)
		pbMgr.StartIfIdle(context.Background())
	}()
	return &Room{
		Info:     info,
		Queue:    qMgr,
		Playback: pbMgr,
		Party:    partyEng,
	}
}

// EnsureDefaultRoom ensures the 'default' room row exists.
func EnsureDefaultRoom(ctx context.Context, database *sqlx.DB) error {
	_, err := database.ExecContext(ctx, `
		INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at)
		VALUES ('default', 'Hoved-scene', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
	return err
}
