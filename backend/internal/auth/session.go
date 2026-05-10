package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"

	"github.com/crownjukebox/crownjukebox/internal/db"
)

// contextKey is unexported to avoid collisions.
type contextKey string

const (
	SessionContextKey contextKey = "session"
	UserContextKey    contextKey = "user"
)

// SessionData is stored in request context after successful authentication.
type SessionData struct {
	Session     db.Session
	User        db.User
	Permissions db.UserPermissions
}

// Service handles session creation, validation and revocation.
type Service struct {
	db         *sqlx.DB
	sessionTTL time.Duration
}

func NewService(database *sqlx.DB, sessionTTLHours int) *Service {
	return &Service{
		db:         database,
		sessionTTL: time.Duration(sessionTTLHours) * time.Hour,
	}
}

// HashPassword hashes a plain-text password using bcrypt.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckPassword verifies a plain-text password against a bcrypt hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateSecureToken creates a cryptographically random 32-byte hex token.
func GenerateSecureToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// HashToken returns the SHA-256 hex of a token (for storage, never store plaintext).
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// CreateSession generates a new session token for the user and persists it.
// Returns the plaintext token (only time it's available — not stored).
func (s *Service) CreateSession(ctx context.Context, userID, deviceName, userAgent, ipAddress string) (string, error) {
	token, err := GenerateSecureToken()
	if err != nil {
		return "", err
	}

	session := db.Session{
		ID:               uuid.NewString(),
		UserID:           userID,
		SessionTokenHash: HashToken(token),
		DeviceName:       deviceName,
		UserAgent:        userAgent,
		IPAddress:        ipAddress,
		CreatedAt:        time.Now(),
		ExpiresAt:        time.Now().Add(s.sessionTTL),
		LastSeenAt:       time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO sessions
			(id, user_id, session_token_hash, device_name, user_agent, ip_address, is_guest_session, created_at, expires_at, last_seen_at)
		VALUES
			(?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
		session.ID, session.UserID, session.SessionTokenHash,
		session.DeviceName, session.UserAgent, session.IPAddress,
		session.CreatedAt, session.ExpiresAt, session.LastSeenAt,
	)
	if err != nil {
		return "", fmt.Errorf("insert session: %w", err)
	}

	return token, nil
}

// CreateGuestSession generates a session for a QR access-link user.
// The session is flagged is_guest_session=1, which prevents audio playback on the client.
func (s *Service) CreateGuestSession(ctx context.Context, userID, deviceName, userAgent, ipAddress string) (string, error) {
	token, err := GenerateSecureToken()
	if err != nil {
		return "", err
	}

	session := db.Session{
		ID:               uuid.NewString(),
		UserID:           userID,
		SessionTokenHash: HashToken(token),
		DeviceName:       deviceName,
		UserAgent:        userAgent,
		IPAddress:        ipAddress,
		IsGuestSession:   true,
		CreatedAt:        time.Now(),
		ExpiresAt:        time.Now().Add(s.sessionTTL),
		LastSeenAt:       time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO sessions
			(id, user_id, session_token_hash, device_name, user_agent, ip_address, is_guest_session, created_at, expires_at, last_seen_at)
		VALUES
			(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
		session.ID, session.UserID, session.SessionTokenHash,
		session.DeviceName, session.UserAgent, session.IPAddress,
		session.CreatedAt, session.ExpiresAt, session.LastSeenAt,
	)
	if err != nil {
		return "", fmt.Errorf("insert guest session: %w", err)
	}

	return token, nil
}

// ValidateToken looks up a session by token hash and validates all access rules.
// Returns the fully populated SessionData or an error if invalid.
func (s *Service) ValidateToken(ctx context.Context, token string) (*SessionData, error) {
	hash := HashToken(token)

	var session db.Session
	err := s.db.GetContext(ctx, &session, `
		SELECT * FROM sessions
		WHERE session_token_hash = ?
		  AND revoked_at IS NULL
		  AND expires_at > CURRENT_TIMESTAMP`,
		hash,
	)
	if err != nil {
		return nil, fmt.Errorf("session not found or expired")
	}

	var user db.User
	if err := s.db.GetContext(ctx, &user, `SELECT * FROM users WHERE id = ?`, session.UserID); err != nil {
		return nil, fmt.Errorf("user not found")
	}

	// Check user is still active
	if !user.IsActive {
		return nil, fmt.Errorf("user account is disabled")
	}

	// Check access period
	now := time.Now()
	if !user.IsPermanent {
		if user.AccessExpiresAt != nil && now.After(*user.AccessExpiresAt) {
			return nil, fmt.Errorf("access period expired")
		}
		if user.AccessStartsAt != nil && now.Before(*user.AccessStartsAt) {
			return nil, fmt.Errorf("access period not started")
		}
	}

	var perms db.UserPermissions
	if err := s.db.GetContext(ctx, &perms, `SELECT * FROM user_permissions WHERE user_id = ?`, user.ID); err != nil {
		// Provide safe defaults if permissions row is missing
		perms = db.UserPermissions{
			UserID:            user.ID,
			CanAddToQueue:     true,
			CanSearch:         true,
			CanUsePartyButton: false,
			CanViewQueue:      true,
		}
	}

	// Update last_seen_at
	_, _ = s.db.ExecContext(ctx, `
		UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, session.ID)
	_, _ = s.db.ExecContext(ctx, `
		UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, user.ID)

	return &SessionData{
		Session:     session,
		User:        user,
		Permissions: perms,
	}, nil
}

// RevokeSession marks a session as revoked immediately.
func (s *Service) RevokeSession(ctx context.Context, sessionID string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`, sessionID)
	return err
}

// RevokeAllUserSessions revokes every active session for a user.
func (s *Service) RevokeAllUserSessions(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE sessions
		SET revoked_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND revoked_at IS NULL`, userID)
	return err
}

// GetSessionFromContext retrieves the session data from a request context.
func GetSessionFromContext(ctx context.Context) (*SessionData, bool) {
	sd, ok := ctx.Value(SessionContextKey).(*SessionData)
	return sd, ok
}
