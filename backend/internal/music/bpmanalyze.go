package music

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os/exec"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
)

// BPMProgress is broadcast over SSE while a BPM analysis scan is running.
type BPMProgress struct {
	Total     int    `json:"total"`
	Processed int    `json:"processed"`
	Done      bool   `json:"done"`
	Error     string `json:"error,omitempty"`
}

// BPMAnalyzer iterates over tracks without BPM and analyses them via ffmpeg.
type BPMAnalyzer struct {
	db *sqlx.DB
}

// NewBPMAnalyzer constructs a BPMAnalyzer backed by the given database.
func NewBPMAnalyzer(db *sqlx.DB) *BPMAnalyzer {
	return &BPMAnalyzer{db: db}
}

// AnalyzeMissing finds all playable tracks whose bpm = 0 and computes their tempo.
// Progress updates are sent on the supplied channel (may be nil). The channel is
// closed when the function returns.
func (a *BPMAnalyzer) AnalyzeMissing(progress chan<- BPMProgress) error {
	type row struct {
		ID       string `db:"id"`
		FilePath string `db:"file_path"`
	}
	var tracks []row
	if err := a.db.Select(&tracks, `
		SELECT id, file_path FROM tracks
		WHERE bpm = 0
		  AND source_type IN ('local','party_upload')
		  AND file_path != ''
		ORDER BY file_path`); err != nil {
		return fmt.Errorf("query tracks: %w", err)
	}

	total := len(tracks)
	if progress != nil {
		progress <- BPMProgress{Total: total, Processed: 0}
	}
	defer func() {
		if progress != nil {
			close(progress)
		}
	}()

	for i, t := range tracks {
		bpm := ComputeBPM(t.FilePath)
		if bpm > 0 {
			if _, err := a.db.Exec(`UPDATE tracks SET bpm = ? WHERE id = ?`, bpm, t.ID); err != nil {
				log.Printf("[bpm-scan] update %s: %v", t.ID, err)
			}
		}
		if progress != nil {
			done := i+1 == total
			progress <- BPMProgress{Total: total, Processed: i + 1, Done: done}
		}
	}
	return nil
}

// AnalyzeAll resets BPM to 0 for all local tracks and then re-analyzes every
// one of them — useful when you want to refresh BPM data from scratch.
func (a *BPMAnalyzer) AnalyzeAll(progress chan<- BPMProgress) error {
	if _, err := a.db.Exec(`UPDATE tracks SET bpm = 0 WHERE source_type IN ('local','party_upload')`); err != nil {
		return fmt.Errorf("reset bpm: %w", err)
	}
	return a.AnalyzeMissing(progress)
}

// ComputeBPM returns the estimated BPM for the given audio file.
// It first tries to read a BPM tag via ffprobe; if that returns 0 it falls back
// to audio analysis using ffmpeg + onset autocorrelation.
// Returns 0 when ffmpeg is unavailable, the file is unreadable, or no clear tempo
// can be detected.
func ComputeBPM(filePath string) int {
	// Fast path: tag-based (reads more variants than dhowden/tag via ffprobe JSON)
	if bpm := bpmFromFFprobeTag(filePath); bpm > 0 {
		return bpm
	}
	// Slow path: audio analysis
	return estimateBPMFromAudio(filePath)
}

// bpmFromFFprobeTag reads BPM from audio file metadata using ffprobe.
// ffprobe understands a wider variety of tag encodings than dhowden/tag.
func bpmFromFFprobeTag(filePath string) int {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		filePath,
	)
	cmd.Stderr = io.Discard
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	var result struct {
		Format struct {
			Tags map[string]string `json:"tags"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		return 0
	}
	for _, key := range []string{"TBPM", "TBP", "BPM", "bpm", "TEMPO", "tempo", "tmpo", "TMPO"} {
		if v, ok := result.Format.Tags[key]; ok {
			// Strip any fractional part (e.g. "128.0" → "128")
			clean := strings.TrimSpace(strings.SplitN(v, ".", 2)[0])
			if n, err := strconv.Atoi(clean); err == nil && n > 0 && n < 300 {
				return n
			}
		}
	}
	return 0
}

// estimateBPMFromAudio decodes the first 45 seconds of an audio file at 8 kHz
// mono via ffmpeg and estimates tempo using onset-strength autocorrelation.
//
// Algorithm:
//  1. Decode to raw 16-bit PCM at 8000 Hz / mono (small but sufficient for beat detection)
//  2. Compute RMS energy in overlapping 50 ms windows (25 ms hop → 40 fps)
//  3. Half-wave rectify the first difference → onset-strength function
//  4. Autocorrelation over the onset function for beat-period lags spanning 55–205 BPM
//  5. Pick the lag with maximum correlation and convert to BPM
//  6. Range-fold result to [60, 160] BPM
func estimateBPMFromAudio(filePath string) int {
	// Decode via ffmpeg. Pipe raw PCM to stdout.
	cmd := exec.Command("ffmpeg",
		"-i", filePath,
		"-t", "45", // only first 45 s — enough for reliable beat detection
		"-f", "s16le", // signed 16-bit little-endian raw PCM
		"-ar", "8000", // 8 kHz sample rate
		"-ac", "1", // mono
		"-", // write to stdout
	)
	cmd.Stderr = io.Discard
	data, err := cmd.Output()
	if err != nil || len(data) < 16000 { // need at least 1 s of audio (8000 samples × 2 bytes)
		return 0
	}

	const sampleRate = 8000

	// Convert raw bytes to normalised float64 samples.
	n := len(data) / 2
	samples := make([]float64, n)
	for i := 0; i < n; i++ {
		v := int16(binary.LittleEndian.Uint16(data[i*2 : i*2+2]))
		samples[i] = float64(v) / 32768.0
	}

	// RMS energy in 50 ms windows, 25 ms hop.
	const winSize = sampleRate / 20 // 400 samples = 50 ms
	const hopSize = sampleRate / 40 // 200 samples = 25 ms
	numFrames := (n - winSize) / hopSize
	if numFrames < 10 {
		return 0
	}
	energy := make([]float64, numFrames)
	for i := 0; i < numFrames; i++ {
		start := i * hopSize
		end := start + winSize
		if end > n {
			end = n
		}
		sum := 0.0
		for j := start; j < end; j++ {
			sum += samples[j] * samples[j]
		}
		energy[i] = math.Sqrt(sum / float64(winSize))
	}

	// Onset strength: positive first difference of energy envelope.
	onset := make([]float64, numFrames)
	maxOnset := 0.0
	for i := 1; i < numFrames; i++ {
		if d := energy[i] - energy[i-1]; d > 0 {
			onset[i] = d
			if d > maxOnset {
				maxOnset = d
			}
		}
	}
	if maxOnset == 0 {
		return 0 // silent or near-silent file
	}
	// Normalise onset to [0, 1].
	for i := range onset {
		onset[i] /= maxOnset
	}

	// Autocorrelation.
	// fps (onset frames per second) = sampleRate / hopSize = 8000 / 200 = 40
	const fps = float64(sampleRate) / float64(hopSize) // 40.0

	// Lag range corresponding to 55–205 BPM.
	minLag := int(math.Round(fps * 60.0 / 205.0)) // ≈ 12 frames
	maxLag := int(math.Round(fps * 60.0 / 55.0))  // ≈ 44 frames
	if maxLag >= numFrames {
		maxLag = numFrames - 1
	}

	bestLag := 0
	bestCorr := -1.0
	for lag := minLag; lag <= maxLag; lag++ {
		corr := 0.0
		count := numFrames - lag
		for i := 0; i < count; i++ {
			corr += onset[i] * onset[i+lag]
		}
		corr /= float64(count) // length-normalise
		if corr > bestCorr {
			bestCorr = corr
			bestLag = lag
		}
	}
	if bestLag == 0 {
		return 0
	}

	// Convert lag to BPM and range-fold to [60, 160].
	bpm := fps * 60.0 / float64(bestLag)
	for bpm > 160 {
		bpm /= 2
	}
	for bpm < 60 {
		bpm *= 2
	}

	result := int(math.Round(bpm))
	if result < 55 || result > 200 {
		return 0
	}
	return result
}
