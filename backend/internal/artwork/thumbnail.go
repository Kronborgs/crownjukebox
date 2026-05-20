package artwork

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"
)

// ThumbnailPaths holds the file paths for the three thumbnail sizes.
type ThumbnailPaths struct {
	Small  string // 128x128
	Medium string // 300x300
	Large  string // 600x600
}

// ThumbnailGenerator creates and caches thumbnail images.
type ThumbnailGenerator struct {
	cacheDir string
}

func NewThumbnailGenerator(cacheDir string) *ThumbnailGenerator {
	return &ThumbnailGenerator{cacheDir: cacheDir}
}

// Generate creates thumbnails from raw image data.
// Returns the paths, original dimensions, and any error.
func (t *ThumbnailGenerator) Generate(artID string, data []byte, mimeType string) (ThumbnailPaths, int, int, error) {
	// Decode image
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return ThumbnailPaths{}, 0, 0, fmt.Errorf("decode image: %w", err)
	}

	bounds := img.Bounds()
	origW := bounds.Max.X - bounds.Min.X
	origH := bounds.Max.Y - bounds.Min.Y

	sizes := []struct {
		name string
		px   int
	}{
		{"small", 128},
		{"medium", 300},
		{"large", 600},
	}

	var paths ThumbnailPaths

	for _, s := range sizes {
		dir := filepath.Join(t.cacheDir, "thumbs", s.name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return ThumbnailPaths{}, origW, origH, fmt.Errorf("create thumb dir: %w", err)
		}

		outPath := filepath.Join(dir, artID+".jpg")

		// Resize using Lanczos (high quality)
		resized := imaging.Fill(img, s.px, s.px, imaging.Center, imaging.Lanczos)

		f, err := os.Create(outPath)
		if err != nil {
			return ThumbnailPaths{}, origW, origH, fmt.Errorf("create thumb file: %w", err)
		}

		if err := jpeg.Encode(f, resized, &jpeg.Options{Quality: 85}); err != nil {
			f.Close()
			return ThumbnailPaths{}, origW, origH, fmt.Errorf("encode thumb: %w", err)
		}
		f.Close()

		switch s.name {
		case "small":
			paths.Small = outPath
		case "medium":
			paths.Medium = outPath
		case "large":
			paths.Large = outPath
		}
	}

	return paths, origW, origH, nil
}
