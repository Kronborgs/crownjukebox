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
	".wma":  true, // transcoded to MP3 on the fly at stream time
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

	// Remove albums that ended up with no tracks (dedup / stale-artist artifacts).
	// These are always genuinely empty — we never touch files on disk.
	if res, err := s.db.Exec(`
		DELETE FROM albums
		WHERE source_type != 'party_upload'
		  AND (SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id) = 0`); err != nil {
		log.Printf("[scanner] cleanup empty albums: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[scanner] removed %d empty album(s)", n)
	}

	// Remove artists with no albums and no tracks.
	if res, err := s.db.Exec(`
		DELETE FROM artists
		WHERE (SELECT COUNT(*) FROM albums WHERE albums.artist_id = artists.id) = 0
		  AND (SELECT COUNT(*) FROM tracks WHERE tracks.artist_id = artists.id) = 0`); err != nil {
		log.Printf("[scanner] cleanup empty artists: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[scanner] removed %d empty artist(s)", n)
	}

	// NOTE: orphaned tracks (DB entries whose file no longer exists on disk) are
	// intentionally NOT removed here. The scanner only adds / updates — it never
	// deletes track records automatically. Use the admin "Diskanalyse" panel to
	// review and manually remove stale entries if desired.

	// Build/sync one playlist per top-level subdirectory so users can browse
	// their music by category (e.g. "Aeldre", "Yngre") and use them for autoplay.
	s.buildFolderPlaylists()

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
//
// Safety guard: if more than 10 % of the local library would be deleted in one
// pass, the deletion is aborted and a warning is logged. This prevents
// accidental mass-deletion caused by temporary mount issues, Unicode path
// normalisation differences, or MusicBrainz Picard mid-rename state.
func (s *Scanner) removeOrphanedTracks() (int, error) {
	rows, err := s.db.Queryx(`SELECT id, file_path FROM tracks WHERE source_type = 'local'`)
	if err != nil {
		return 0, fmt.Errorf("query local tracks: %w", err)
	}
	defer rows.Close()

	musicPrefix := filepath.Clean(s.musicDir) + string(os.PathSeparator)

	var total int
	var orphanIDs []string
	var sampleOrphans []string
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
		total++
		if _, statErr := os.Stat(fp); os.IsNotExist(statErr) {
			orphanIDs = append(orphanIDs, id)
			if len(sampleOrphans) < 5 {
				sampleOrphans = append(sampleOrphans, fp)
			}
		}
	}
	rows.Close()

	if len(orphanIDs) == 0 {
		return 0, nil
	}

	// Safety guard: never silently delete more than 10 % of the local library
	// in one scan pass. A spike this large almost always indicates a mount
	// problem, mid-rename state (MusicBrainz Picard), or a path change —
	// not genuine orphans. Log a warning and skip deletion so the operator
	// can investigate.
	if total > 0 && len(orphanIDs)*10 > total {
		log.Printf("[scanner] WARN: orphan check would delete %d/%d tracks (>10%%) — skipping deletion to prevent data loss. Sample missing paths: %v",
			len(orphanIDs), total, sampleOrphans)
		return 0, nil
	}

	log.Printf("[scanner] deleting %d orphaned track(s). Sample: %v", len(orphanIDs), sampleOrphans)
	for _, id := range orphanIDs {
		if _, err := s.db.Exec(`DELETE FROM tracks WHERE id = ?`, id); err != nil {
			log.Printf("[scanner] delete orphan track %s: %v", id, err)
		}
	}
	return len(orphanIDs), nil
}

// DiskAnalysisResult holds the output of DiskAnalysis.
type DiskAnalysisResult struct {
	FilesOnDisk     int            `json:"files_on_disk"`
	ByExtension     map[string]int `json:"by_extension"`
	TracksInDB      int            `json:"tracks_in_db"`
	OrphanedTracks  int            `json:"orphaned_tracks"` // in DB but missing on disk
	UnindexedFiles  int            `json:"unindexed_files"` // on disk but not in DB
	SampleOrphans   []string       `json:"sample_orphans"`
	SampleUnindexed []string       `json:"sample_unindexed"`
}

// DiskAnalysis compares files on disk against local tracks in the database and
// returns a summary. It never modifies the database or filesystem.
func (s *Scanner) DiskAnalysis() (*DiskAnalysisResult, error) {
	// --- Step 1: Walk disk ---
	diskFiles := make(map[string]bool)
	byExt := make(map[string]int)
	err := filepath.WalkDir(s.musicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if supportedExtensions[ext] {
			diskFiles[filepath.Clean(path)] = true
			byExt[ext]++
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk music dir: %w", err)
	}

	// --- Step 2: Load DB tracks ---
	type row struct {
		FilePath string `db:"file_path"`
	}
	var dbRows []row
	if err := s.db.Select(&dbRows, `SELECT file_path FROM tracks WHERE source_type = 'local'`); err != nil {
		return nil, fmt.Errorf("query tracks: %w", err)
	}

	// --- Step 3: Find orphans (in DB, missing on disk) ---
	var sampleOrphans []string
	orphanCount := 0
	for _, r := range dbRows {
		clean := filepath.Clean(r.FilePath)
		if !diskFiles[clean] {
			orphanCount++
			if len(sampleOrphans) < 20 {
				sampleOrphans = append(sampleOrphans, r.FilePath)
			}
		}
	}

	// --- Step 4: Find unindexed files (on disk, not in DB) ---
	dbPaths := make(map[string]bool, len(dbRows))
	for _, r := range dbRows {
		dbPaths[filepath.Clean(r.FilePath)] = true
	}
	var sampleUnindexed []string
	unindexedCount := 0
	for p := range diskFiles {
		if !dbPaths[p] {
			unindexedCount++
			if len(sampleUnindexed) < 20 {
				sampleUnindexed = append(sampleUnindexed, p)
			}
		}
	}

	if sampleOrphans == nil {
		sampleOrphans = []string{}
	}
	if sampleUnindexed == nil {
		sampleUnindexed = []string{}
	}

	return &DiskAnalysisResult{
		FilesOnDisk:     len(diskFiles),
		ByExtension:     byExt,
		TracksInDB:      len(dbRows),
		OrphanedTracks:  orphanCount,
		UnindexedFiles:  unindexedCount,
		SampleOrphans:   sampleOrphans,
		SampleUnindexed: sampleUnindexed,
	}, nil
}

// PurgeOrphans removes local tracks from the database whose file no longer
// exists on disk. This is an explicit manual operation — it is never called
// automatically during a scan. Returns the number of tracks removed.
func (s *Scanner) PurgeOrphans() (int, error) {
	rows, err := s.db.Queryx(`SELECT id, file_path FROM tracks WHERE source_type = 'local'`)
	if err != nil {
		return 0, fmt.Errorf("query local tracks: %w", err)
	}
	defer rows.Close()

	var orphanIDs []string
	for rows.Next() {
		var id, fp string
		if err := rows.Scan(&id, &fp); err != nil {
			continue
		}
		if _, statErr := os.Stat(fp); os.IsNotExist(statErr) {
			orphanIDs = append(orphanIDs, id)
		}
	}
	rows.Close()

	for _, id := range orphanIDs {
		if _, err := s.db.Exec(`DELETE FROM tracks WHERE id = ?`, id); err != nil {
			log.Printf("[scanner] purge orphan %s: %v", id, err)
		}
	}
	log.Printf("[scanner] purged %d orphaned track(s) via manual admin action", len(orphanIDs))
	return len(orphanIDs), nil
}

// ─── Incomplete metadata report ──────────────────────────────────────────────

// IncompleteTrack describes a local track whose metadata could not be fully
// resolved by the scanner — the file exists but has one or more "Unknown"
// values that could not be inferred from tags or folder structure.
type IncompleteTrack struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Artist   string   `json:"artist"`
	Album    string   `json:"album"`
	Duration int      `json:"duration_secs"`
	BPM      int      `json:"bpm"`
	FilePath string   `json:"file_path"`
	Issues   []string `json:"issues"` // human-readable list of what is missing
}

// IncompleteMetadata returns local tracks that are missing one or more key
// metadata fields (artist, album, duration). The results are ordered by
// file_path so the caller can see which folders are affected.
func (s *Scanner) IncompleteMetadata() ([]IncompleteTrack, error) {
	type row struct {
		ID       string `db:"id"`
		Title    string `db:"title"`
		Artist   string `db:"artist_name"`
		Album    string `db:"album_title"`
		Duration int    `db:"duration"`
		BPM      int    `db:"bpm"`
		FilePath string `db:"file_path"`
	}

	var rows []row
	err := s.db.Select(&rows, `
		SELECT
			t.id,
			t.title,
			ar.name  AS artist_name,
			al.title AS album_title,
			t.duration,
			t.bpm,
			t.file_path
		FROM tracks t
		JOIN artists ar ON ar.id = t.artist_id
		JOIN albums  al ON al.id = t.album_id
		WHERE t.source_type = 'local'
		  AND (
		        ar.name  IN ('Unknown Artist', '')
		     OR al.title IN ('Unknown Album',  '')
		     OR t.duration = 0
		  )
		ORDER BY t.file_path ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query incomplete tracks: %w", err)
	}

	result := make([]IncompleteTrack, 0, len(rows))
	for _, r := range rows {
		issues := []string{}
		if r.Artist == "Unknown Artist" || r.Artist == "" {
			issues = append(issues, "unknown_artist")
		}
		if r.Album == "Unknown Album" || r.Album == "" {
			issues = append(issues, "unknown_album")
		}
		if r.Duration == 0 {
			issues = append(issues, "missing_duration")
		}
		result = append(result, IncompleteTrack{
			ID:       r.ID,
			Title:    r.Title,
			Artist:   r.Artist,
			Album:    r.Album,
			Duration: r.Duration,
			BPM:      r.BPM,
			FilePath: r.FilePath,
			Issues:   issues,
		})
	}
	return result, nil
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
	albumID, err := s.upsertAlbum(artistID, meta, filePath)
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

	if m != nil {
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
	}

	// Fill in missing metadata from the file's directory hierarchy.
	// This handles untagged files or files tagged with only partial information,
	// common in ripped collections where folder names carry "Artist - Album" info.
	inferFromPath(&meta, filePath)

	// Extract BPM from raw tags.
	// Key variants covered:
	//   TBPM       — ID3v2.3/2.4 (MP3)
	//   TBP        — ID3v2.2 (older MP3)
	//   BPM / bpm  — Vorbis Comments (FLAC, OGG, Opus)
	//   TEMPO/tempo — alternative Vorbis field used by some taggers
	//   tmpo       — iTunes MP4/M4A atom (stored as int16 by dhowden/tag)
	if m != nil {
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
	}

	// Duration — dhowden/tag does not expose a Duration() method.
	// Read from format-specific binary headers (FLAC STREAMINFO, MPEG Xing/Info
	// frame, M4A mvhd atom) or the TLEN/LENGTH embedded tag.
	meta.Duration = getDurationSecs(filePath, m)

	return meta
}

func (s *Scanner) upsertArtist(name string) (string, error) {
	if name == "" {
		name = "Unknown Artist"
	}

	var existing db.Artist
	err := s.db.Get(&existing, `SELECT * FROM artists WHERE LOWER(name) = LOWER(?) LIMIT 1`, name)
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

func (s *Scanner) upsertAlbum(artistID string, meta Metadata, filePath string) (string, error) {
	albumSourceID := normalizedAlbumSourceID(filePath)
	albumFolderName := filepath.Base(albumSourceID)
	if albumFolderName == "." || albumFolderName == string(filepath.Separator) {
		albumFolderName = meta.Album
	}

	var existing db.Album
	if albumSourceID != "" {
		err := s.db.Get(&existing, `
			SELECT * FROM albums
			WHERE artist_id = ?
			  AND source_type != 'party_upload'
			  AND source_id = ?
			LIMIT 1`, artistID, albumSourceID)
		if err == nil {
			if existing.Title != albumFolderName || existing.SourceID != albumSourceID {
				_, _ = s.db.Exec(`
					UPDATE albums
					SET title = ?, source_id = ?, updated_at = ?
					WHERE id = ?`, albumFolderName, albumSourceID, time.Now(), existing.ID)
			}
			return existing.ID, nil
		}
	}

	if filePath != "" && albumSourceID != "" {
		trackDirPattern := albumSourceID + string(filepath.Separator) + "%"
		err := s.db.Get(&existing, `
			SELECT al.* FROM albums al
			WHERE al.artist_id = ?
			  AND al.source_type != 'party_upload'
			  AND al.id IN (
				  SELECT DISTINCT album_id FROM tracks
				  WHERE file_path LIKE ?
			  )
			ORDER BY al.track_count DESC, al.created_at ASC
			LIMIT 1`, artistID, trackDirPattern)
		if err == nil {
			_, _ = s.db.Exec(`
				UPDATE albums
				SET title = ?, source_id = ?, updated_at = ?
				WHERE id = ?`, albumFolderName, albumSourceID, time.Now(), existing.ID)
			return existing.ID, nil
		}
	}

	err := s.db.Get(&existing, `
		SELECT * FROM albums WHERE artist_id = ? AND LOWER(title) = LOWER(?) LIMIT 1`,
		artistID, meta.Album,
	)
	if err == nil {
		return existing.ID, nil
	}

	// Fallback 1: find an existing album with the same title AND year.
	// Only applied when we have a year — this handles compilations where each
	// track has a different AlbumArtist tag. Without a year the match is too
	// ambiguous: "Greatest Hits" by Guns N' Roses must not merge with
	// "Greatest Hits" by ABBA just because both lack a year tag.
	// Exclude party_upload albums to prevent SKÅL tracks from contaminating
	// the regular library.
	if meta.Year > 0 {
		err = s.db.Get(&existing, `SELECT * FROM albums WHERE LOWER(title) = LOWER(?) AND year = ? AND source_type != 'party_upload' LIMIT 1`, meta.Album, meta.Year)
		if err == nil {
			return existing.ID, nil
		}
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`
		INSERT INTO albums (id, artist_id, album_artist_id, title, year, genre, source_type, source_id, cover_status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'local', ?, 'missing', ?, ?)`,
		id, artistID, artistID, albumFolderName, meta.Year, meta.Genre, albumSourceID, time.Now(), time.Now(),
	)
	if err != nil {
		return "", fmt.Errorf("upsert album %q: %w", albumFolderName, err)
	}
	return id, nil
}

func (s *Scanner) upsertTrack(albumID, artistID, filePath string, meta Metadata) error {
	var existing db.Track
	err := s.db.Get(&existing, `SELECT * FROM tracks WHERE file_path = ?`, filePath)
	if err == nil {
		// Update all metadata in case tags changed after retagging (e.g. MusicBrainz Picard).
		// Critically this includes artist_id and album_id — without updating these the
		// track would stay linked to the old stale artist/album forever.
		// BPM / duration: prefer positive values; never overwrite a hard-won value with 0.
		_, err = s.db.Exec(`
			UPDATE tracks
			SET title=?, artist_id=?, album_id=?,
			    track_number=?, disc_number=?,
			    duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
			    bpm = CASE WHEN ? > 0 THEN ? ELSE bpm END,
			    updated_at=?
			WHERE id=?`,
			meta.Title, artistID, albumID,
			meta.TrackNumber, meta.DiscNumber,
			meta.Duration, meta.Duration,
			meta.BPM, meta.BPM, time.Now(), existing.ID,
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

// ─── Path-based metadata inference ──────────────────────────────────────────

// inferFromPath fills in missing Album, Artist, TrackNumber, DiscNumber and Year
// from the file's directory hierarchy when embedded tags are absent or generic.
//
// Supported folder structures (at any depth below the music root):
//
//	…/Artist - Album Title/track.mp3
//	…/Artist - Album Title/CD1/track.mp3
//	…/Category/Artist - Album Title/Disc 2/track.mp3
//	…/Album Title/track.mp3
//	…/Artist - Discography/1973 - Album Title/track.mp3   ← year-prefix pattern
//	…/Artist/track.mp3                                     ← flat artist folder
func inferFromPath(meta *Metadata, filePath string) {
	dir := filepath.Dir(filePath)
	folderName := filepath.Base(dir)

	// 1. Detect and strip a disc subfolder (CD1, Disc 2, Disk 1, …).
	if n := parseDiscFolder(folderName); n > 0 {
		if meta.DiscNumber <= 1 {
			meta.DiscNumber = n
		}
		dir = filepath.Dir(dir)
		folderName = filepath.Base(dir)
	}

	// 2. Detect a year-prefixed album folder: "1973 - Piano Man", "2005 - Greatest Hits".
	//    This is common in "Artist - Discography/YYYY - Album/" hierarchies.
	//    When found, extract the year + album and step up one level to find the artist.
	if yr, albumFromYear := parseYearAlbumFolder(folderName); yr > 0 {
		if meta.Year == 0 {
			meta.Year = yr
		}
		if meta.Album == "Unknown Album" || meta.Album == "" {
			meta.Album = albumFromYear
		}
		// Move up — the parent folder likely carries the artist name.
		dir = filepath.Dir(dir)
		folderName = filepath.Base(dir)
	}

	// 3. Parse the current folder as "Artist - Album" or plain "Name".
	folderArtist, folderAlbum := splitArtistAlbumFolder(folderName)

	// If the "album" part is a generic suffix (e.g. "Discography", "Anthology"),
	// discard it so we never store "Discography" as an album title.
	if isDiscographySuffix(folderAlbum) {
		folderAlbum = ""
	}

	// Fill in album when still unknown.
	if meta.Album == "Unknown Album" || meta.Album == "" {
		if folderAlbum != "" && folderAlbum != "." {
			meta.Album = folderAlbum
		} else if folderArtist == "" && folderName != "" && folderName != "." {
			// No " - " separator: the plain folder name becomes the album.
			// (For a flat artist folder like "ABBA/", the folder doubles as both
			// album grouping and provides the artist via the next block.)
			meta.Album = folderName
		}
	}

	// Fill in artist from an explicit "Artist - " prefix in the folder name.
	// We intentionally do this even when the album was already known from tags,
	// so that a file whose tag has the album but no artist can still inherit the
	// artist from a folder like "Aerosmith - Big Ones/".
	if folderArtist != "" && (meta.AlbumArtist == "Unknown Artist" || meta.AlbumArtist == "") {
		meta.AlbumArtist = folderArtist
		if meta.Artist == "Unknown Artist" || meta.Artist == "" {
			meta.Artist = folderArtist
		}
	}

	// For plain (no " - ") folders: use the folder name as artist only when the
	// artist is still completely unknown and the folder looks like a solo-artist
	// collection (no explicit artist-album split available anywhere so far).
	if folderArtist == "" &&
		(meta.AlbumArtist == "Unknown Artist" || meta.AlbumArtist == "") &&
		folderName != "" && folderName != "." {
		meta.AlbumArtist = folderName
		if meta.Artist == "Unknown Artist" || meta.Artist == "" {
			meta.Artist = folderName
		}
	}

	// Propagate AlbumArtist → Artist when only one of the two is missing.
	if meta.Artist == "Unknown Artist" || meta.Artist == "" {
		if meta.AlbumArtist != "Unknown Artist" && meta.AlbumArtist != "" {
			meta.Artist = meta.AlbumArtist
		}
	}

	// 4. Infer track number from a leading numeric prefix on the filename,
	//    e.g. "01 Welcome To The Jungle.mp3" or "03 - Paradise City.mp3".
	if meta.TrackNumber == 0 {
		meta.TrackNumber = parseTrackNumberFromFilename(filepath.Base(filePath))
	}
}

// parseYearAlbumFolder detects a folder name that starts with a 4-digit year
// optionally followed by a separator and the album title.
//
//	"1973 - Piano Man"   → (1973, "Piano Man")
//	"2005 Greatest Hits" → (2005, "Greatest Hits")
//	"ABBA"               → (0, "")
//
// Returns (0, "") when no year prefix is detected.
func parseYearAlbumFolder(name string) (year int, album string) {
	name = strings.TrimSpace(name)
	if len(name) < 4 {
		return 0, ""
	}
	yr, err := strconv.Atoi(name[:4])
	if err != nil || yr < 1900 || yr > 2100 {
		return 0, ""
	}
	// Must be followed by a space, dash, or underscore — not just a year-like
	// number in the middle of a word (e.g. "19730s Rock").
	if len(name) == 4 {
		return yr, "" // bare year, no album title
	}
	sep := name[4]
	if sep != ' ' && sep != '-' && sep != '_' {
		return 0, ""
	}
	rest := strings.TrimSpace(name[4:])
	rest = strings.TrimLeft(rest, "- _")
	rest = strings.TrimSpace(rest)
	return yr, rest
}

// isDiscographySuffix reports whether s is a standalone collection/discography
// label that should not be used as an album title.
func isDiscographySuffix(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "discography", "anthology", "complete collection",
		"complete works", "the complete collection",
		"box set", "collection", "archives":
		return true
	}
	return false
}

// parseDiscFolder returns n > 0 if the folder name looks like a disc/CD
// subfolder (e.g. "CD1", "CD 2", "Disc 1", "disk2"), otherwise 0.
func parseDiscFolder(name string) int {
	lower := strings.ToLower(strings.TrimSpace(name))
	for _, prefix := range []string{"cd ", "cd", "disc ", "disc", "disk ", "disk"} {
		if strings.HasPrefix(lower, prefix) {
			rest := strings.TrimSpace(lower[len(prefix):])
			if n, err := strconv.Atoi(rest); err == nil && n > 0 && n <= 20 {
				return n
			}
		}
	}
	return 0
}

// splitArtistAlbumFolder splits a folder name of the form "Artist - Album Title"
// into (artist, album). Returns ("", name) when no " - " separator is present.
func splitArtistAlbumFolder(name string) (artist, album string) {
	if idx := strings.Index(name, " - "); idx > 0 {
		return strings.TrimSpace(name[:idx]), strings.TrimSpace(name[idx+3:])
	}
	return "", name
}

// parseTrackNumberFromFilename extracts a leading numeric track number from a
// filename (without extension), e.g. "01 Song.mp3" → 1, "05 - Title.mp3" → 5.
// Returns 0 if no unambiguous leading number is found.
func parseTrackNumberFromFilename(filename string) int {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	end := 0
	for end < len(name) && name[end] >= '0' && name[end] <= '9' {
		end++
	}
	// Accept 1–3 digit track numbers; reject bare "1999" year-prefixed filenames
	if end >= 1 && end <= 3 {
		if n, err := strconv.Atoi(name[:end]); err == nil && n > 0 && n < 500 {
			return n
		}
	}
	return 0
}

// normalizedAlbumSourceID returns the stable folder path used to group local
// tracks into a single album. Disc subfolders are collapsed so CD1/CD2 share
// the same album root.
func normalizedAlbumSourceID(filePath string) string {
	if filePath == "" {
		return ""
	}
	dir := filepath.Dir(filePath)
	if parseDiscFolder(filepath.Base(dir)) > 0 {
		dir = filepath.Dir(dir)
	}
	return filepath.Clean(dir)
}

// ─── Folder-based playlist building ─────────────────────────────────────────

// buildFolderPlaylists creates or syncs one playlist per direct subdirectory
// of the music root. Each playlist contains all local tracks whose file path
// lives inside that subdirectory, sorted by path (which naturally groups by
// album and, when filenames carry track numbers, preserves track order).
//
// Playlists are identified by source_type='folder' and source_id=<dirPath> so
// repeated scans update existing playlists without creating duplicates.
func (s *Scanner) buildFolderPlaylists() {
	entries, err := os.ReadDir(s.musicDir)
	if err != nil {
		log.Printf("[scanner] read music dir for folder playlists: %v", err)
		return
	}

	// Fetch all local tracks ordered by path for fast in-Go prefix matching.
	type trackRow struct {
		ID       string `db:"id"`
		FilePath string `db:"file_path"`
	}
	var allTracks []trackRow
	if err := s.db.Select(&allTracks, `
		SELECT id, file_path FROM tracks
		WHERE source_type = 'local'
		ORDER BY file_path ASC`); err != nil {
		log.Printf("[scanner] fetch tracks for folder playlists: %v", err)
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirPath := filepath.Join(s.musicDir, entry.Name())
		prefix := dirPath + string(os.PathSeparator)
		playlistName := entry.Name()

		// Collect all track IDs whose path lives inside this subtree.
		var trackIDs []string
		for _, t := range allTracks {
			if strings.HasPrefix(t.FilePath, prefix) {
				trackIDs = append(trackIDs, t.ID)
			}
		}
		if len(trackIDs) == 0 {
			continue
		}

		// Find or create the folder playlist.
		var playlistID string
		err := s.db.Get(&playlistID, `
			SELECT id FROM playlists
			WHERE source_type = 'folder' AND source_id = ?`, dirPath)
		if err != nil {
			playlistID = uuid.NewString()
			if _, err := s.db.Exec(`
				INSERT INTO playlists (id, name, source_type, source_id, is_party_playlist, created_at)
				VALUES (?, ?, 'folder', ?, 0, CURRENT_TIMESTAMP)`,
				playlistID, playlistName, dirPath); err != nil {
				log.Printf("[scanner] create folder playlist %q: %v", playlistName, err)
				continue
			}
			log.Printf("[scanner] created folder playlist %q with %d tracks", playlistName, len(trackIDs))
		} else {
			// Keep name in sync in case the folder was renamed.
			_, _ = s.db.Exec(`UPDATE playlists SET name = ? WHERE id = ?`, playlistName, playlistID)
		}

		// Rebuild playlist_tracks in a transaction so partial updates are avoided.
		tx, err := s.db.Beginx()
		if err != nil {
			log.Printf("[scanner] begin tx for folder playlist %q: %v", playlistName, err)
			continue
		}
		_, _ = tx.Exec(`DELETE FROM playlist_tracks WHERE playlist_id = ?`, playlistID)
		for pos, tid := range trackIDs {
			_, _ = tx.Exec(`
				INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, is_intro)
				VALUES (?, ?, ?, 0)`, playlistID, tid, pos+1)
		}
		if err := tx.Commit(); err != nil {
			log.Printf("[scanner] commit folder playlist %q: %v", playlistName, err)
			_ = tx.Rollback()
			continue
		}
		log.Printf("[scanner] synced folder playlist %q (%d tracks)", playlistName, len(trackIDs))
	}
}
