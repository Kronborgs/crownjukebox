package music

// getDurationSecs returns the playback duration of filePath in whole seconds.
// It tries, in priority order:
//  1. TLEN / LENGTH embedded tag (stored in milliseconds)
//  2. Format-specific binary headers:
//     • FLAC  — STREAMINFO metadata block (exact, lossless)
//     • MP3   — Xing/Info VBR header (exact) → CBR bitrate estimate (fallback)
//     • M4A   — mvhd / mdhd atom (exact)
//
// Returns 0 when duration cannot be determined.
//
// NOTE: dhowden/tag does not expose a Duration() method, so all duration
// reading is done independently of the tag library.

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dhowden/tag"
)

func getDurationSecs(filePath string, m tag.Metadata) int {
	// 1. Tag-embedded duration (fastest path)
	if m != nil {
		if s := tagDuration(m); s > 0 {
			return s
		}
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	f, err := os.Open(filePath)
	if err != nil {
		return 0
	}
	defer f.Close()

	fi, _ := f.Stat()
	var fileSize int64
	if fi != nil {
		fileSize = fi.Size()
	}

	switch ext {
	case ".flac":
		return flacDuration(f)
	case ".mp3":
		return mp3Duration(f, fileSize)
	case ".m4a":
		return m4aDuration(f)
	}
	return 0
}

// ─── Tag-based ───────────────────────────────────────────────────────────────

// tagDuration reads TLEN (ID3, milliseconds) or LENGTH (Vorbis Comment,
// milliseconds) from the raw tag map and returns whole seconds, or 0.
func tagDuration(m tag.Metadata) int {
	raw := m.Raw()
	if raw == nil {
		return 0
	}
	for _, key := range []string{"TLEN", "tlen", "LENGTH", "length"} {
		v, ok := raw[key]
		if !ok {
			continue
		}
		s := strings.TrimSpace(fmt.Sprintf("%v", v))
		// Strip decimal part — TLEN/LENGTH store whole milliseconds as a string
		if dot := strings.Index(s, "."); dot > 0 {
			s = s[:dot]
		}
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil && ms > 0 {
			return int(ms / 1000)
		}
	}
	return 0
}

// ─── FLAC ────────────────────────────────────────────────────────────────────

// flacDuration reads the mandatory STREAMINFO block from an open FLAC file
// and returns duration in whole seconds, or 0 on any error.
func flacDuration(f *os.File) int {
	magic := make([]byte, 4)
	if _, err := io.ReadFull(f, magic); err != nil || string(magic) != "fLaC" {
		return 0
	}
	for {
		var hdr [4]byte
		if _, err := io.ReadFull(f, hdr[:]); err != nil {
			return 0
		}
		last := hdr[0]&0x80 != 0
		blockType := hdr[0] & 0x7F
		length := int(hdr[1])<<16 | int(hdr[2])<<8 | int(hdr[3])

		if blockType == 0 && length >= 18 { // STREAMINFO
			d := make([]byte, length)
			if _, err := io.ReadFull(f, d); err != nil {
				return 0
			}
			// Bytes 10-12 encode the 20-bit sample rate:
			//   d[10] = SR[19:12], d[11] = SR[11:4], d[12][7:4] = SR[3:0]
			sampleRate := uint32(d[10])<<12 | uint32(d[11])<<4 | uint32(d[12])>>4
			// Bytes 13-17 encode the 36-bit total-sample count:
			//   d[13][3:0] = samples[35:32], d[14..17] = samples[31:0]
			totalSamples := uint64(d[13]&0x0F)<<32 |
				uint64(d[14])<<24 | uint64(d[15])<<16 |
				uint64(d[16])<<8 | uint64(d[17])
			if sampleRate == 0 {
				return 0
			}
			return int(totalSamples / uint64(sampleRate))
		}

		if _, err := f.Seek(int64(length), io.SeekCurrent); err != nil {
			return 0
		}
		if last {
			break
		}
	}
	return 0
}

// ─── MP3 ─────────────────────────────────────────────────────────────────────

// mp3Duration extracts the duration of an MP3 in whole seconds.
// Strategy:
//  1. Skip the ID3v2 header (if present) to locate the first MPEG frame.
//  2. If the frame contains a Xing/Info VBR header, use its frame count
//     to compute an exact duration.
//  3. Fall back to estimating duration from the CBR bitrate and audio data size.
func mp3Duration(f *os.File, fileSize int64) int {
	// Determine ID3v2 tag size (synchsafe integer in bytes 6-9 of the 10-byte header)
	var id3Size int64
	hdr := make([]byte, 10)
	if _, err := f.ReadAt(hdr, 0); err == nil && string(hdr[0:3]) == "ID3" {
		sizeRaw := (int64(hdr[6]&0x7F) << 21) |
			(int64(hdr[7]&0x7F) << 14) |
			(int64(hdr[8]&0x7F) << 7) |
			int64(hdr[9]&0x7F)
		id3Size = 10 + sizeRaw
	}

	// Scan up to 8 KB after the ID3 tag for the first valid MPEG frame header
	buf := make([]byte, 8192)
	n, _ := f.ReadAt(buf, id3Size)
	frameOff := -1
	var frameHdr uint32
	for i := 0; i < n-3; i++ {
		if buf[i] != 0xFF || buf[i+1]&0xE0 != 0xE0 {
			continue
		}
		h := uint32(buf[i])<<24 | uint32(buf[i+1])<<16 | uint32(buf[i+2])<<8 | uint32(buf[i+3])
		ver := (h >> 19) & 3
		lyr := (h >> 17) & 3
		bri := (h >> 12) & 0xF
		sri := (h >> 10) & 3
		// Reject reserved/invalid combinations
		if ver == 1 || lyr == 0 || bri == 0 || bri == 15 || sri == 3 {
			continue
		}
		frameOff = i
		frameHdr = h
		break
	}
	if frameOff < 0 {
		return 0
	}

	ver := (frameHdr >> 19) & 3  // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
	bri := (frameHdr >> 12) & 0xF
	sri := (frameHdr >> 10) & 3
	chm := (frameHdr >> 6) & 3 // 3=mono

	// Sample rates per [version][sri]
	sampleRates := [4][3]uint32{
		{11025, 12000, 8000},  // MPEG2.5 (ver=0)
		{0, 0, 0},             // reserved (ver=1)
		{22050, 24000, 16000}, // MPEG2    (ver=2)
		{44100, 48000, 32000}, // MPEG1    (ver=3)
	}
	if sri >= 3 {
		return 0
	}
	sampleRate := sampleRates[ver][sri]
	if sampleRate == 0 {
		return 0
	}

	// Byte offset of Xing/Info header inside the frame body (after 4-byte frame header):
	//   MPEG1  stereo=32, mono=17
	//   MPEG2+ stereo=17, mono=9
	isMono := chm == 3
	isMPEG1 := ver == 3
	var sideInfoLen int64
	switch {
	case isMPEG1 && !isMono:
		sideInfoLen = 32
	case isMPEG1 && isMono:
		sideInfoLen = 17
	case !isMPEG1 && !isMono:
		sideInfoLen = 17
	default:
		sideInfoLen = 9
	}
	xingPos := id3Size + int64(frameOff) + 4 + sideInfoLen
	xb := make([]byte, 12)
	if _, err := f.ReadAt(xb, xingPos); err == nil {
		t := string(xb[:4])
		if t == "Xing" || t == "Info" {
			flags := binary.BigEndian.Uint32(xb[4:8])
			if flags&0x1 != 0 { // Frames field present
				numFrames := binary.BigEndian.Uint32(xb[8:12])
				// MPEG1 Layer3: 1152 samples/frame; MPEG2/2.5: 576 samples/frame
				samplesPerFrame := uint64(1152)
				if !isMPEG1 {
					samplesPerFrame = 576
				}
				return int(uint64(numFrames) * samplesPerFrame / uint64(sampleRate))
			}
		}
	}

	// CBR fallback: estimate from bitrate × audio data size
	brMPEG1 := [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
	brMPEG2 := [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}
	var bitrate int
	if isMPEG1 {
		bitrate = brMPEG1[bri]
	} else {
		bitrate = brMPEG2[bri]
	}
	if bitrate == 0 || fileSize == 0 {
		return 0
	}
	audioSize := fileSize - id3Size
	return int(audioSize * 8 / int64(bitrate) / 1000)
}

// ─── M4A / MP4 ───────────────────────────────────────────────────────────────

// m4aDuration parses the MP4 atom tree to find the mvhd atom and return
// the track duration in whole seconds, or 0 on any error.
func m4aDuration(f *os.File) int {
	fi, err := f.Stat()
	if err != nil {
		return 0
	}
	return mp4ScanAtoms(f, 0, fi.Size())
}

// mp4ScanAtoms recursively walks MP4 container atoms looking for 'mvhd'.
func mp4ScanAtoms(f *os.File, offset, end int64) int {
	for offset < end-8 {
		var hdr [8]byte
		if _, err := f.ReadAt(hdr[:], offset); err != nil {
			return 0
		}
		size := int64(binary.BigEndian.Uint32(hdr[0:4]))
		name := string(hdr[4:8])
		if size < 8 {
			break
		}
		switch name {
		case "moov", "trak", "mdia", "minf", "stbl":
			// Container atom — recurse into it
			if d := mp4ScanAtoms(f, offset+8, offset+size); d > 0 {
				return d
			}
		case "mvhd":
			// version byte at offset+8 determines 32-bit vs 64-bit fields
			var ver [1]byte
			if _, err := f.ReadAt(ver[:], offset+8); err != nil {
				return 0
			}
			if ver[0] == 1 {
				// version 1: creation(8) + modification(8) + timescale(4) + duration(8)
				var buf [28]byte
				if _, err := f.ReadAt(buf[:], offset+12); err != nil {
					return 0
				}
				ts := binary.BigEndian.Uint32(buf[16:20])
				dur := binary.BigEndian.Uint64(buf[20:28])
				if ts == 0 {
					return 0
				}
				return int(dur / uint64(ts))
			}
			// version 0: creation(4) + modification(4) + timescale(4) + duration(4)
			var buf [16]byte
			if _, err := f.ReadAt(buf[:], offset+12); err != nil {
				return 0
			}
			ts := binary.BigEndian.Uint32(buf[8:12])
			dur := binary.BigEndian.Uint32(buf[12:16])
			if ts == 0 {
				return 0
			}
			return int(uint64(dur) / uint64(ts))
		}
		offset += size
	}
	return 0
}
