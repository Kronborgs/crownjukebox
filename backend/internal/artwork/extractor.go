package artwork

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dhowden/tag"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"github.com/crownjukebox/crownjukebox/internal/db"
)

// candidateFilenames lists cover art filenames to look for in order of priority.
var candidateFilenames = []string{
	"cover.jpg", "cover.jpeg", "cover.png",
	"folder.jpg", "folder.jpeg", "folder.png",
	"front.jpg", "front.jpeg", "front.png",
	"albumart.jpg", "AlbumArt.jpg", "albumart.png", "AlbumArt.png",
	"album.jpg", "album.jpeg", "album.png",
}

// ExtractProgress is sent during artwork extraction.
type ExtractProgress struct {
	Total     int
	Processed int
	Done      bool
	AlbumID   string
}

// Extractor finds and caches album art for all albums in the database.
type Extractor struct {
	db       *sqlx.DB
	cacheDir string
	thumbGen *ThumbnailGenerator
}

func NewExtractor(database *sqlx.DB, cacheDir string) *Extractor {
	return &Extractor{
		db:       database,
		cacheDir: cacheDir,
		thumbGen: NewThumbnailGenerator(cacheDir),
	}
}

// ExtractAll processes all albums and finds/generates cover art.
func (e *Extractor) ExtractAll(progress chan<- ExtractProgress) error {
	var albums []db.Album
	if err := e.db.Select(&albums, `SELECT * FROM albums WHERE source_type = 'local'`); err != nil {
		return fmt.Errorf("list albums: %w", err)
	}

	total := len(albums)
	for i, album := range albums {
		if err := e.ExtractForAlbum(&album); err != nil {
			log.Printf("[artwork] error on album %s: %v", album.Title, err)
		}
		if progress != nil {
			progress <- ExtractProgress{Total: total, Processed: i + 1, AlbumID: album.ID}
		}
	}

	if progress != nil {
		progress <- ExtractProgress{Total: total, Processed: total, Done: true}
	}
	return nil
}

// ExtractMissing processes only albums without cover art.
func (e *Extractor) ExtractMissing(progress chan<- ExtractProgress) error {
	var albums []db.Album
	if err := e.db.Select(&albums, `
		SELECT * FROM albums
		WHERE source_type = 'local'
		  AND (cover_status = 'missing' OR cover_art_id IS NULL OR cover_art_id = '')`); err != nil {
		return fmt.Errorf("list albums without art: %w", err)
	}

	total := len(albums)
	for i, album := range albums {
		if err := e.ExtractForAlbum(&album); err != nil {
			log.Printf("[artwork] error on album %s: %v", album.Title, err)
		}
		if progress != nil {
			progress <- ExtractProgress{Total: total, Processed: i + 1, AlbumID: album.ID}
		}
	}

	if progress != nil {
		progress <- ExtractProgress{Total: total, Processed: total, Done: true}
	}
	return nil
}

// ExtractForAlbum finds the best available cover art for a single album.
func (e *Extractor) ExtractForAlbum(album *db.Album) error {
	// Get the first track for this album to know the directory and check embedded art
	var firstTrack db.Track
	err := e.db.Get(&firstTrack, `
		SELECT * FROM tracks WHERE album_id = ?
		ORDER BY disc_number, track_number LIMIT 1`, album.ID)
	if err != nil {
		return nil // no tracks yet
	}

	trackDir := filepath.Dir(firstTrack.FilePath)

	// Candidate directories: track dir itself, and one level up (handles CD1/CD2 subfolders).
	artDirs := []string{trackDir}
	parent := filepath.Dir(trackDir)
	if parent != trackDir {
		artDirs = append(artDirs, parent)
	}

	// 1. Try embedded art from each track file
	var tracks []db.Track
	_ = e.db.Select(&tracks, `SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number, track_number`, album.ID)

	for _, track := range tracks {
		artData, mimeType, err := extractEmbeddedArt(track.FilePath)
		if err == nil && len(artData) > 0 {
			return e.saveArtwork(album, track.ID, "embedded", track.FilePath, artData, mimeType)
		}
	}

	// 2. Try folder-level image files in track dir and parent (for multi-disc albums).
	for _, dir := range artDirs {
		for _, candidate := range candidateFilenames {
			candidatePath := filepath.Join(dir, candidate)
			data, err := os.ReadFile(candidatePath)
			if err == nil && len(data) > 0 {
				mimeType := mimeTypeFromExt(filepath.Ext(candidate))
				return e.saveArtwork(album, "", "folder_file", candidatePath, data, mimeType)
			}
		}
	}

	// 2b. Fallback: pick ANY image file in any of the candidate dirs.
	for _, dir := range artDirs {
		if entries, err := os.ReadDir(dir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				ext := strings.ToLower(filepath.Ext(entry.Name()))
				if ext == ".jpg" || ext == ".jpeg" || ext == ".png" {
					candidatePath := filepath.Join(dir, entry.Name())
					data, err := os.ReadFile(candidatePath)
					if err == nil && len(data) > 0 {
						mimeType := mimeTypeFromExt(ext)
						return e.saveArtwork(album, "", "folder_file", candidatePath, data, mimeType)
					}
				}
			}
		}
	}

	// 3. Generate retro placeholder if nothing found
	return e.generatePlaceholder(album)
}

// saveArtwork hashes, caches, generates thumbnails and records the artwork.
func (e *Extractor) saveArtwork(album *db.Album, trackID, sourceType, sourcePath string, data []byte, mimeType string) error {
	hash := sha256hex(data)

	// Check if we already have this exact image
	var existing db.AlbumArt
	err := e.db.Get(&existing, `SELECT * FROM album_art WHERE original_hash = ?`, hash)
	if err == nil {
		// Already cached — just link the album to it
		return e.linkAlbumToArt(album.ID, existing.ID)
	}

	artID := uuid.NewString()
	ext := extFromMime(mimeType)

	// Save original to cache
	origDir := filepath.Join(e.cacheDir, "originals")
	if err := os.MkdirAll(origDir, 0755); err != nil {
		return fmt.Errorf("create originals dir: %w", err)
	}
	origPath := filepath.Join(origDir, artID+ext)
	if err := os.WriteFile(origPath, data, 0644); err != nil {
		return fmt.Errorf("write original: %w", err)
	}

	// Generate thumbnails
	thumbs, w, h, err := e.thumbGen.Generate(artID, data, mimeType)
	if err != nil {
		log.Printf("[artwork] thumbnail error for %s: %v", album.Title, err)
		thumbs = ThumbnailPaths{}
	}

	art := db.AlbumArt{
		ID:           artID,
		AlbumID:      album.ID,
		TrackID:      trackID,
		SourceType:   sourceType,
		SourcePath:   sourcePath,
		OriginalHash: hash,
		MimeType:     mimeType,
		Width:        w,
		Height:       h,
		SmallPath:    thumbs.Small,
		MediumPath:   thumbs.Medium,
		LargePath:    thumbs.Large,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	_, err = e.db.Exec(`
		INSERT INTO album_art
			(id, album_id, track_id, source_type, source_path, original_hash, mime_type, width, height,
			 small_path, medium_path, large_path, color_palette_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
		art.ID, art.AlbumID, art.TrackID, art.SourceType, art.SourcePath,
		art.OriginalHash, art.MimeType, art.Width, art.Height,
		art.SmallPath, art.MediumPath, art.LargePath,
		art.CreatedAt, art.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert album_art: %w", err)
	}

	return e.linkAlbumToArt(album.ID, artID)
}

func (e *Extractor) generatePlaceholder(album *db.Album) error {
	gen := NewPlaceholderGenerator(e.cacheDir)

	var artistName string
	_ = e.db.Get(&artistName, `SELECT name FROM artists WHERE id = ? LIMIT 1`, album.ArtistID)

	data, err := gen.Generate(album.ID, artistName, album.Title)
	if err != nil {
		return fmt.Errorf("generate placeholder: %w", err)
	}

	return e.saveArtwork(album, "", "generated", "", data, "image/png")
}

func (e *Extractor) linkAlbumToArt(albumID, artID string) error {
	_, err := e.db.Exec(`
		UPDATE albums
		SET cover_art_id = ?, cover_status = 'found', updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		artID, albumID,
	)
	return err
}

// extractEmbeddedArt opens an audio file and reads the embedded picture tag.
func extractEmbeddedArt(filePath string) ([]byte, string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		return nil, "", err
	}

	pic := m.Picture()
	if pic == nil || len(pic.Data) == 0 {
		return nil, "", fmt.Errorf("no embedded picture")
	}

	mimeType := pic.MIMEType
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	return pic.Data, mimeType, nil
}

func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func mimeTypeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	default:
		return "image/jpeg"
	}
}

func extFromMime(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	default:
		return ".jpg"
	}
}

// GetCoverData reads and returns raw image data for a given size.
// size: small | medium | large
func GetCoverData(cacheDir string, art *db.AlbumArt, size string) ([]byte, string, error) {
	var path string
	switch size {
	case "small":
		path = art.SmallPath
	case "medium":
		path = art.MediumPath
	case "large":
		path = art.LargePath
	default:
		path = art.MediumPath
	}

	if path == "" {
		// Fall back to large or medium
		if art.LargePath != "" {
			path = art.LargePath
		} else if art.MediumPath != "" {
			path = art.MediumPath
		} else if art.SmallPath != "" {
			path = art.SmallPath
		}
	}

	if path == "" {
		return nil, "", fmt.Errorf("no cached image available")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("read cover: %w", err)
	}

	mimeType := mimeTypeFromExt(filepath.Ext(path))
	return data, mimeType, nil
}

// ReadSeeker wraps os.File to satisfy io.ReadSeekCloser for streaming.
func OpenCover(path string) (io.ReadSeekCloser, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	return f, info.Size(), nil
}
