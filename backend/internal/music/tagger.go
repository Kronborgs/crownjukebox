package music

import (
	"fmt"
	"os"
	"os/exec"
)

// WriteAlbumArtistTag updates the AlbumArtist tag of an audio file in-place
// using ffmpeg (already present in the Docker image). The stream is copied
// without re-encoding, so quality is preserved and the operation is fast.
//
// Supported formats: mp3, flac, ogg, m4a (all handled by ffmpeg metadata
// mapping: album_artist → ID3v2 TPE2 / Vorbis ALBUMARTIST / iTunes aART).
func WriteAlbumArtistTag(filePath, albumArtist string) error {
	tmpPath := filePath + ".mbtag_tmp"

	args := []string{
		"-y",                              // overwrite temp without prompting
		"-i", filePath,                    // input
		"-c", "copy",                      // copy all streams (no re-encode)
		"-metadata", "album_artist=" + albumArtist, // write AlbumArtist
		tmpPath,                           // output
	}

	cmd := exec.Command("ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("ffmpeg: %w — %s", err, string(out))
	}

	// Replace original atomically (same mount → same filesystem → rename is atomic).
	if err := os.Rename(tmpPath, filePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace file: %w", err)
	}
	return nil
}
