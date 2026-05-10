package external

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/artwork"
	"github.com/crownjukebox/crownjukebox/internal/queue"
)

// activeDownloads tracks video IDs currently being downloading to avoid duplicates.
var activeDownloads = make(map[string]bool)

// illegalChars matches characters not allowed in filenames on Windows/Linux.
var illegalChars = regexp.MustCompile(`[\\/:*?"<>|]`)

func safeFilename(artistName, title string) string {
	name := artistName + " - " + title
	name = illegalChars.ReplaceAllString(name, "_")
	if len(name) > 180 {
		name = name[:180]
	}
	return name
}

type ytDLPInfo struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Uploader  string  `json:"uploader"`
	Creator   string  `json:"creator"`
	Artist    string  `json:"artist"`
	Duration  float64 `json:"duration"`
	Thumbnail string  `json:"thumbnail"`
}

// DownloadAndQueue fetches metadata immediately, queues the track, then downloads
// in the background. Returns song metadata as soon as the track is queued.
func DownloadAndQueue(
	ctx context.Context,
	database *sqlx.DB,
	externalDir, videoID, roomID, userID string,
) (AddedSong, error) {
	if err := os.MkdirAll(externalDir, 0o755); err != nil {
		return AddedSong{}, fmt.Errorf("create external dir: %w", err)
	}

	videoURL := "https://www.youtube.com/watch?v=" + videoID

	// Re-use a previously downloaded track if available.
	var existingID string
	if err := database.GetContext(ctx, &existingID,
		`SELECT id FROM tracks WHERE source_type = 'youtube' AND source_id = ?`, videoID,
	); err == nil {
		log.Printf("[external] youtube:%s already in library, skipping download", videoID)
		return enqueue(ctx, database, existingID, roomID, userID)
	}

	// ── Fetch metadata (fast, ~1-2s) ────────────────────────────
	metaCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	metaOut, err := exec.CommandContext(metaCtx, "yt-dlp",
		"--dump-json", "--no-playlist", videoURL,
	).Output()
	if err != nil {
		return AddedSong{}, fmt.Errorf("yt-dlp metadata: %w", err)
	}

	var info ytDLPInfo
	if err := json.Unmarshal(metaOut, &info); err != nil {
		return AddedSong{}, fmt.Errorf("parse yt-dlp json: %w", err)
	}

	// Best-effort artist name: prefer tagged artist > creator > uploader.
	artistName := info.Uploader
	if info.Artist != "" {
		artistName = info.Artist
	} else if info.Creator != "" {
		artistName = info.Creator
	}

	// ── Upsert artist / album / track (before download) ─────────
	artistID, err := upsertArtist(ctx, database, artistName)
	if err != nil {
		return AddedSong{}, fmt.Errorf("upsert artist: %w", err)
	}

	albumID, err := upsertYouTubeAlbum(ctx, database, artistID)
	if err != nil {
		return AddedSong{}, fmt.Errorf("upsert album: %w", err)
	}

	filePath := filepath.Join(externalDir, safeFilename(artistName, info.Title)+".m4a")
	trackID := uuid.NewString()
	now := time.Now()
	_, err = database.ExecContext(ctx, `
		INSERT INTO tracks
			(id, album_id, artist_id, title, track_number, disc_number,
			 duration, file_path, source_type, source_id, stream_url, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, 1, ?, ?, 'youtube', ?, '', ?, ?)`,
		trackID, albumID, artistID,
		info.Title,
		int(info.Duration),
		filePath,
		videoID,
		now, now,
	)
	if err != nil {
		return AddedSong{}, fmt.Errorf("insert track: %w", err)
	}

	// ── Queue immediately, download in background ────────────────
	result, err := enqueue(ctx, database, trackID, roomID, userID)
	if err != nil {
		// Clean up track record if we can't queue it.
		_, _ = database.ExecContext(ctx, `DELETE FROM tracks WHERE id = ?`, trackID)
		return AddedSong{}, err
	}

	if !activeDownloads[videoID] {
		activeDownloads[videoID] = true
		go func() {
			defer func() { delete(activeDownloads, videoID) }()
		outTemplate := filepath.Join(externalDir, safeFilename(artistName, info.Title)+".%(ext)s")
			dlCtx, dlCancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer dlCancel()
			dlOut, dlErr := exec.CommandContext(dlCtx, "yt-dlp",
				"--extract-audio",
				"--audio-format", "m4a",
				"--audio-quality", "0",
				"--no-playlist",
				"-o", outTemplate,
				videoURL,
			).CombinedOutput()
			if dlErr != nil {
				log.Printf("[external] yt-dlp download failed for %s: %v\n%s", videoID, dlErr, string(dlOut))
				return
			}
			log.Printf("[external] download complete: %s %q by %q", videoID, info.Title, artistName)
			// Save YouTube thumbnail as cover art for the album.
			if info.Thumbnail != "" {
				saveYouTubeThumbnail(database, albumID, info.Thumbnail, externalDir)
			}
		}()
	}

	return result, nil
}

// saveYouTubeThumbnail downloads the YouTube video thumbnail and stores it as
// cover art for the album, only if the album doesn't already have art.
func saveYouTubeThumbnail(database *sqlx.DB, albumID, thumbnailURL, cacheDir string) {
	// Skip if album already has art.
	var existing string
	if err := database.Get(&existing, `SELECT COALESCE(cover_art_id,'') FROM albums WHERE id = ?`, albumID); err == nil && existing != "" {
		return
	}

	resp, err := http.Get(thumbnailURL) //nolint:noctx
	if err != nil {
		log.Printf("[external] thumbnail fetch failed: %v", err)
		return
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[external] thumbnail read failed: %v", err)
		return
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	hashBytes := sha256.Sum256(data)
	hash := hex.EncodeToString(hashBytes[:])

	// Check for duplicate by hash.
	var dupID string
	if err := database.Get(&dupID, `SELECT id FROM album_art WHERE original_hash = ?`, hash); err == nil {
		// Art already exists, just link it.
		_, _ = database.Exec(`UPDATE albums SET cover_art_id = ?, cover_status = 'found', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, dupID, albumID)
		return
	}

	thumbGen := artwork.NewThumbnailGenerator(cacheDir)
	artID := uuid.NewString()
	thumbs, w, h, err := thumbGen.Generate(artID, data, mimeType)
	if err != nil {
		log.Printf("[external] thumbnail generate failed: %v", err)
		return
	}

	now := time.Now()
	_, err = database.Exec(`
		INSERT INTO album_art
			(id, album_id, track_id, source_type, source_path, original_hash, mime_type, width, height,
			 small_path, medium_path, large_path, color_palette_json, created_at, updated_at)
		VALUES (?, ?, '', 'external', ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
		artID, albumID, thumbnailURL, hash, mimeType, w, h,
		thumbs.Small, thumbs.Medium, thumbs.Large, now, now,
	)
	if err != nil {
		log.Printf("[external] insert album_art failed: %v", err)
		return
	}

	_, _ = database.Exec(`UPDATE albums SET cover_art_id = ?, cover_status = 'found', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, artID, albumID)
	log.Printf("[external] saved thumbnail for album %s", albumID)
}

// enqueue adds an already-existing track to the room queue and returns its metadata.
func enqueue(ctx context.Context, database *sqlx.DB, trackID, roomID, userID string) (AddedSong, error) {
	var t struct {
		Title      string `db:"title"`
		ArtistName string `db:"artist_name"`
	}
	if err := database.GetContext(ctx, &t,
		`SELECT t.title, COALESCE(a.name, '') AS artist_name
		 FROM tracks t LEFT JOIN artists a ON a.id = t.artist_id
		 WHERE t.id = ?`, trackID,
	); err != nil {
		return AddedSong{}, fmt.Errorf("get track: %w", err)
	}

	mgr := queue.NewManager(database, roomID)
	if _, err := mgr.AddTrack(ctx, trackID, userID); err != nil {
		// "already in queue" is acceptable — just log it.
		log.Printf("[external] queue add note: %v", err)
	}

	return AddedSong{Title: t.Title, Artist: t.ArtistName}, nil
}

func upsertArtist(ctx context.Context, database *sqlx.DB, name string) (string, error) {
	var id string
	if err := database.GetContext(ctx, &id,
		`SELECT id FROM artists WHERE name = ?`, name,
	); err == nil {
		return id, nil
	}
	id = uuid.NewString()
	now := time.Now()
	_, err := database.ExecContext(ctx, `
		INSERT INTO artists (id, name, sort_name, musicbrainz_id, created_at, updated_at)
		VALUES (?, ?, ?, '', ?, ?)`, id, name, name, now, now)
	return id, err
}

func upsertYouTubeAlbum(ctx context.Context, database *sqlx.DB, artistID string) (string, error) {
	var id string
	if err := database.GetContext(ctx, &id, `
		SELECT id FROM albums WHERE artist_id = ? AND source_type = 'youtube' LIMIT 1`,
		artistID,
	); err == nil {
		return id, nil
	}
	id = uuid.NewString()
	now := time.Now()
	_, err := database.ExecContext(ctx, `
		INSERT INTO albums
			(id, artist_id, album_artist_id, title, year, genre, source_type, source_id,
			 cover_status, track_count, created_at, updated_at)
		VALUES (?, ?, ?, 'YouTube Downloads', 0, '', 'youtube', '', 'missing', 0, ?, ?)`,
		id, artistID, artistID, now, now)
	return id, err
}
