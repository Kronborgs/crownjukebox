// Package external manages the QR-based mobile YouTube add-to-queue flow.
// Sessions are kept in memory only — they expire after 30 minutes and are
// never persisted to the database.
package external

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// SessionStatus represents the lifecycle of a mobile QR session.
type SessionStatus string

const (
	StatusPending SessionStatus = "pending"
	StatusDone    SessionStatus = "done"
)

// AddedSong holds the metadata of a song successfully downloaded and queued.
type AddedSong struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

// ExternalSession is a short-lived record linking a QR scan on a mobile device
// to a specific jukebox room and user.
type ExternalSession struct {
	ID        string
	RoomID    string
	UserID    string
	CreatedAt time.Time
	ExpiresAt time.Time
	Status    SessionStatus
	AddedSong *AddedSong
}

// Store is a goroutine-safe in-memory store for external sessions.
type Store struct {
	mu       sync.Mutex
	sessions map[string]*ExternalSession
}

// NewStore creates a Store and starts a background cleanup goroutine.
func NewStore() *Store {
	s := &Store{sessions: make(map[string]*ExternalSession)}
	go s.cleanup()
	return s
}

// Create registers a new 30-minute session and returns it.
func (s *Store) Create(roomID, userID string) *ExternalSession {
	id := randomToken()
	sess := &ExternalSession{
		ID:        id,
		RoomID:    roomID,
		UserID:    userID,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(30 * time.Minute),
		Status:    StatusPending,
	}
	s.mu.Lock()
	s.sessions[id] = sess
	s.mu.Unlock()
	return sess
}

// Get retrieves a session by its ID. Returns nil if missing or expired.
func (s *Store) Get(id string) *ExternalSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || time.Now().After(sess.ExpiresAt) {
		return nil
	}
	return sess
}

// MarkDone marks a session as completed and stores the song metadata.
func (s *Store) MarkDone(id string, song AddedSong) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[id]; ok {
		sess.Status = StatusDone
		sess.AddedSong = &song
	}
}

// cleanup removes expired sessions every five minutes.
func (s *Store) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		for id, sess := range s.sessions {
			if time.Now().After(sess.ExpiresAt) {
				delete(s.sessions, id)
			}
		}
		s.mu.Unlock()
	}
}

func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}
