package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/skip2/go-qrcode"

	"github.com/crownjukebox/crownjukebox/internal/db"
)

// QRService manages one-time access links for QR-based guest login.
type QRService struct {
	db      *sqlx.DB
	baseURL string // e.g. "http://192.168.1.100:3000"
}

func NewQRService(database *sqlx.DB, baseURL string) *QRService {
	return &QRService{db: database, baseURL: baseURL}
}

// CreateAccessLink generates a one-time login token for a user and stores
// the hash in the database. Returns the plaintext token and the link URL.
func (q *QRService) CreateAccessLink(ctx context.Context, userID string, expiresIn time.Duration) (*db.AccessLink, string, error) {
	token, err := GenerateSecureToken()
	if err != nil {
		return nil, "", fmt.Errorf("generate access link token: %w", err)
	}

	link := &db.AccessLink{
		ID:        uuid.NewString(),
		UserID:    userID,
		TokenHash: HashToken(token),
		CreatedAt: time.Now(),
	}

	if expiresIn > 0 {
		exp := time.Now().Add(expiresIn)
		link.ExpiresAt = &exp
	}

	_, err = q.db.ExecContext(ctx, `
		INSERT INTO access_links (id, user_id, token_hash, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?)`,
		link.ID, link.UserID, link.TokenHash, link.CreatedAt, link.ExpiresAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("insert access link: %w", err)
	}

	loginURL := fmt.Sprintf("%s/login?token=%s", q.baseURL, token)
	return link, loginURL, nil
}

// UseAccessLink validates and marks an access link as used.
// Returns the associated user_id if valid.
func (q *QRService) UseAccessLink(ctx context.Context, token string) (string, error) {
	hash := HashToken(token)

	var link db.AccessLink
	err := q.db.GetContext(ctx, &link, `
		SELECT * FROM access_links
		WHERE token_hash = ?
		  AND used_at IS NULL
		  AND revoked_at IS NULL`,
		hash,
	)
	if err != nil {
		return "", fmt.Errorf("access link not found or already used")
	}

	if link.ExpiresAt != nil && time.Now().After(*link.ExpiresAt) {
		return "", fmt.Errorf("access link expired")
	}

	// Mark as used
	_, err = q.db.ExecContext(ctx, `
		UPDATE access_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, link.ID)
	if err != nil {
		return "", fmt.Errorf("mark link used: %w", err)
	}

	return link.UserID, nil
}

// RevokeAccessLink marks a link as revoked so it can no longer be used.
func (q *QRService) RevokeAccessLink(ctx context.Context, linkID string) error {
	_, err := q.db.ExecContext(ctx, `
		UPDATE access_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`, linkID)
	return err
}

// GenerateQRPNG returns a PNG QR code for the given URL.
func GenerateQRPNG(url string, size int) ([]byte, error) {
	return qrcode.Encode(url, qrcode.Medium, size)
}
