package music

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strconv"
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
		if err := s.indexFile(filePath, ""); err != nil {
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

	// Remove local tracks whose files no longer exist on disk.
	// This handles mount-path changes and deleted files — orphaned entries
	// would otherwise cause 404 stream errors until the next full re-scan.
	if n, err := s.removeOrphanedTracks(); err != nil {
		log.Printf("[scanner] orphan cleanup: %v", err)
	} else if n > 0 {
		log.Printf("[scanner] removed %d orphaned track(s) with missing files", n)
		// Re-update album track counts after orphan removal
		if _, err := s.db.Exec(`
			UPDATE albums SET track_count = (
				SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id
			), updated_at = CURRENT_TIMESTAMP`); err != nil {
			log.Printf("[scanner] update track counts after orphan removal: %v", err)
		}
	}

	// Remove albums that ended up with no tracks (dedup artifacts).
	if res, err := s.db.Exec(`
		DELETE FROM albums
		WHERE source_type != 'party_upload'
		  AND (SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id) = 0`); err != nil {
		log.Printf("[scanner] cleanup empty albums: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[scanner] removed %d empty album(s)", n)
	}

	if progress != nil {
		progress <- ScanProgress{Total: total, Scanned: total, Done: true}
	}

	log.Printf("[scanner] scan complete: %d files", total)
	return nil
}

// removeOrphanedTracks deletes local tracks whose file_path no longer exists on
// disk. Only tracks whose path lives under this scanner's music directory are
// checked, so party uploads and external tracks are left untouched.
// Returns the number of tracks removed.
func (s *Scanner) removeOrphanedTracks() (int, error) {
	rows, err := s.db.Queryx(`SELECT id, file_path FROM tracks WHERE source_type = 'local'`)
	if err != nil {
		return 0, fmt.Errorf("query local tracks: %w", err)
	}
	defer rows.Close()

	musicPrefix := filepath.Clean(s.musicDir) + string(os.PathSeparator)

	var orphanIDs []string
	for rows.Next() {
		var id, fp string
		if err := rows.Scan(&id, &fp); err != nil {
			continue
		}
		// Only check files that live inside the scanned music directory.
		cleanFP := filepath.Clean(fp)
		if cleanFP != filepath.Clean(s.musicDir) && !strings.HasPrefix(cleanFP, musicPrefix) {
			continue
		}
		if _, statErr := os.Stat(fp); os.IsNotExist(statErr) {
			orphanIDs = append(orphanIDs, id)
		}
	}
	rows.Close()

	for _, id := range orphanIDs {
		if _, err := s.db.Exec(`DELETE FROM tracks WHERE id = ?`, id); err != nil {
			log.Printf("[scanner] delete orphan track %s: %v", id, err)
		}
	}
	return len(orphanIDs), nil
}

// IndexFile indexes one specific audio file path.
func (s *Scanner) IndexFile(filePath string) error {
	return s.indexFile(filePath, "")
}

// IndexFileWithOriginalName indexes a file, using originalFilename as fallback title if no tags exist.
func (s *Scanner) IndexFileWithOriginalName(filePath, originalFilename string) error {
	return s.indexFile(filePath, originalFilename)
}

// IndexPartyFile indexes a SKÅL upload file and marks it as source_type='party_upload'
// so it is excluded from the regular music library browser and search.
func (s *Scanner) IndexPartyFile(filePath, originalFilename string) error {
	if err := s.indexFile(filePath, originalFilename); err != nil {
		return err
	}
	// Mark track and its album as party_upload so library queries filter them out
	_, _ = s.db.Exec(`UPDATE tracks SET source_type = 'party_upload' WHERE file_path = ?`, filePath)
	_, _ = s.db.Exec(`
		UPDATE albums SET source_type = 'party_upload'
		WHERE id = (SELECT album_id FROM tracks WHERE file_path = ? LIMIT 1)`, filePath)
	return nil
}

// indexFile reads metadata from a single audio file and upserts it.
func (s *Scanner) indexFile(filePath, originalFilename string) error {
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

	meta := extractMetadata(filePath, originalFilename, m)

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
	Title                  string
	Artist                 string
	AlbumArtist            string
	HasExplicitAlbumArtist bool
	Album                  string
	TrackNumber            int
	DiscNumber             int
	Year                   int
	Genre                  string
	Duration               int
	BPM                    int
}

func extractMetadata(filePath, originalFilename string, m tag.Metadata) Metadata {
	// Use original filename if provided, otherwise use actual file path
	titleFallback := filepath.Base(strings.TrimSuffix(filePath, filepath.Ext(filePath)))
	if originalFilename != "" {
		titleFallback = strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	}

	meta := Metadata{
		Title:       titleFallback,
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
		meta.HasExplicitAlbumArtist = true
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

	// Extract BPM from raw tags.
	// Key variants covered:
	//   TBPM       — ID3v2.3/2.4 (MP3)
	//   TBP        — ID3v2.2 (older MP3)
	//   BPM / bpm  — Vorbis Comments (FLAC, OGG, Opus)
	//   TEMPO/tempo — alternative Vorbis field used by some taggers
	//   tmpo       — iTunes MP4/M4A atom (stored as int16 by dhowden/tag)
	if raw := m.Raw(); raw != nil {
		for _, key := range []string{"TBPM", "TBP", "BPM", "bpm", "TEMPO", "tempo", "Tempo", "tmpo", "TMPO"} {
			if v, ok := raw[key]; ok {
				var bpmStr string
				switch val := v.(type) {
				case int:
					bpmStr = strconv.Itoa(val)
				case int16:
					bpmStr = strconv.Itoa(int(val))
				case int32:
					bpmStr = strconv.Itoa(int(val))
				case int64:
					bpmStr = strconv.FormatInt(val, 10)
				default:
					bpmStr = strings.TrimSpace(strings.Split(fmt.Sprintf("%v", val), ".")[0])
				}
				if n, err := strconv.Atoi(bpmStr); err == nil && n > 0 && n < 300 {
					meta.BPM = n
					break
				}
			}
		}
	}

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

	// Fallback: find an existing album with the same title (and year if known).
	// This handles compilations where each track has a different AlbumArtist tag
	// (e.g. rippers that copy the track artist into AlbumArtist). Using year as
	// a secondary key reduces false merges between same-titled albums by different
	// artists released in different years (e.g. "Greatest Hits" 1982 vs 1996).
	if meta.Year > 0 {
		err = s.db.Get(&existing, `SELECT * FROM albums WHERE title = ? AND year = ? LIMIT 1`, meta.Album, meta.Year)
	} else {
		err = s.db.Get(&existing, `SELECT * FROM albums WHERE title = ? LIMIT 1`, meta.Album)
	}
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
			SET title=?, track_number=?, disc_number=?, duration=?, bpm=?, updated_at=?
			WHERE id=?`,
			meta.Title, meta.TrackNumber, meta.DiscNumber, meta.Duration, meta.BPM, time.Now(), existing.ID,
		)
		return err
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`
		INSERT INTO tracks (id, album_id, artist_id, title, track_number, disc_number, duration, bpm, file_path, source_type, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
		id, albumID, artistID, meta.Title, meta.TrackNumber, meta.DiscNumber, meta.Duration, meta.BPM, filePath,
		time.Now(), time.Now(),
	)
	if err != nil {
		return fmt.Errorf("upsert track %q: %w", meta.Title, err)
	}
	return nil
}
