package music

import (
	"fmt"
	"io/fs"
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

// ScanProgress is sent to the progress channel during library scanning.
type ScanProgress struct {
	Total       int
	Scanned     int
	CurrentFile string
	Done        bool
	Error       string
}

// Scanner handles recursive scanning of the music directory.
type Scanner struct {
	db       *sqlx.DB
	musicDir string
}

func NewScanner(database *sqlx.DB, musicDir string) *Scanner {
	return &Scanner{db: database, musicDir: musicDir}
}

// supportedExtensions defines which audio file types we index.
var supportedExtensions = map[string]bool{
	".mp3":  true,
	".flac": true,
	".ogg":  true,
	".m4a":  true,
}

func SupportedExtension(ext string) bool {
	return supportedExtensions[strings.ToLower(ext)]
}

// Scan walks the music directory and upserts all tracks into the database.
// Progress updates are sent to the progress channel (may be nil).
func (s *Scanner) Scan(progress chan<- ScanProgress) error {
	log.Printf("[scanner] starting scan of %s", s.musicDir)

	// Collect all files first for total count
	var files []string
	err := filepath.WalkDir(s.musicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible paths
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if supportedExtensions[ext] {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("walk music dir: %w", err)
	}

	total := len(files)
	log.Printf("[scanner] found %d audio files", total)

	for i, filePath := range files {
		if err := s.indexFile(filePath); err != nil {
			log.Printf("[scanner] error indexing %s: %v", filePath, err)
		}

		if progress != nil {
			progress <- ScanProgress{
				Total:       total,
				Scanned:     i + 1,
				CurrentFile: filepath.Base(filePath),
			}
		}
	}

	// Update album track counts
	if _, err := s.db.Exec(`
		UPDATE albums SET track_count = (
			SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id
		), updated_at = CURRENT_TIMESTAMP`); err != nil {
		log.Printf("[scanner] update track counts: %v", err)
	}

	if progress != nil {
		progress <- ScanProgress{Total: total, Scanned: total, Done: true}
	}

	log.Printf("[scanner] scan complete: %d files", total)
	return nil
}

// IndexFile indexes one specific audio file path.
func (s *Scanner) IndexFile(filePath string) error {
	return s.indexFile(filePath)
}

// indexFile reads metadata from a single audio file and upserts it.
func (s *Scanner) indexFile(filePath string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		// File might be unreadable or have no tags — use filename as title
		m = nil
	}

	meta := extractMetadata(filePath, m)

	// Upsert artist
	artistID, err := s.upsertArtist(meta.AlbumArtist)
	if err != nil {
		return err
	}

	// Upsert track artist (may differ from album artist)
	trackArtistID := artistID
	if meta.Artist != meta.AlbumArtist && meta.Artist != "" {
		trackArtistID, err = s.upsertArtist(meta.Artist)
		if err != nil {
			return err
		}
	}

	// Upsert album
	albumID, err := s.upsertAlbum(artistID, meta)
	if err != nil {
		return err
	}

	// Upsert track
	return s.upsertTrack(albumID, trackArtistID, filePath, meta)
}

// Metadata holds the extracted tag information for a file.
type Metadata struct {
	Title       string
	Artist      string
	AlbumArtist string
	Album       string
	TrackNumber int
	DiscNumber  int
	Year        int
	Genre       string
	Duration    int
}

func extractMetadata(filePath string, m tag.Metadata) Metadata {
	meta := Metadata{
		Title:       filepath.Base(strings.TrimSuffix(filePath, filepath.Ext(filePath))),
		Artist:      "Unknown Artist",
		AlbumArtist: "Unknown Artist",
		Album:       "Unknown Album",
	}

	if m == nil {
		return meta
	}

	if v := m.Title(); v != "" {
		meta.Title = v
	}
	if v := m.Artist(); v != "" {
		meta.Artist = v
		meta.AlbumArtist = v // default album artist to track artist
	}
	if v := m.AlbumArtist(); v != "" {
		meta.AlbumArtist = v
	}
	if v := m.Album(); v != "" {
		meta.Album = v
	}
	if v := m.Year(); v != 0 {
		meta.Year = v
	}
	if v := m.Genre(); v != "" {
		meta.Genre = v
	}

	n, _ := m.Track()
	meta.TrackNumber = n

	d, _ := m.Disc()
	if d == 0 {
		d = 1
	}
	meta.DiscNumber = d

	return meta
}

func (s *Scanner) upsertArtist(name string) (string, error) {
	if name == "" {
		name = "Unknown Artist"
	}

	var existing db.Artist
	err := s.db.Get(&existing, `SELECT * FROM artists WHERE name = ? LIMIT 1`, name)
	if err == nil {
		return existing.ID, nil
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`
		INSERT INTO artists (id, name, sort_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`,
		id, name, name, time.Now(), time.Now(),
	)
	if err != nil {
		return "", fmt.Errorf("upsert artist %q: %w", name, err)
	}
	return id, nil
}

func (s *Scanner) upsertAlbum(artistID string, meta Metadata) (string, error) {
	var existing db.Album
	err := s.db.Get(&existing, `
		SELECT * FROM albums WHERE artist_id = ? AND title = ? LIMIT 1`,
		artistID, meta.Album,
	)
	if err == nil {
		return existing.ID, nil
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`
		INSERT INTO albums (id, artist_id, album_artist_id, title, year, genre, source_type, cover_status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'local', 'missing', ?, ?)`,
		id, artistID, artistID, meta.Album, meta.Year, meta.Genre, time.Now(), time.Now(),
	)
	if err != nil {
		return "", fmt.Errorf("upsert album %q: %w", meta.Album, err)
	}
	return id, nil
}

func (s *Scanner) upsertTrack(albumID, artistID, filePath string, meta Metadata) error {
	var existing db.Track
	err := s.db.Get(&existing, `SELECT * FROM tracks WHERE file_path = ?`, filePath)
	if err == nil {
		// Update metadata in case tags changed
		_, err = s.db.Exec(`
			UPDATE tracks
			SET title=?, track_number=?, disc_number=?, duration=?, updated_at=?
			WHERE id=?`,
			meta.Title, meta.TrackNumber, meta.DiscNumber, meta.Duration, time.Now(), existing.ID,
		)
		return err
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`
		INSERT INTO tracks (id, album_id, artist_id, title, track_number, disc_number, duration, file_path, source_type, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
		id, albumID, artistID, meta.Title, meta.TrackNumber, meta.DiscNumber, meta.Duration, filePath,
		time.Now(), time.Now(),
	)
	if err != nil {
		return fmt.Errorf("upsert track %q: %w", meta.Title, err)
	}
	return nil
}
