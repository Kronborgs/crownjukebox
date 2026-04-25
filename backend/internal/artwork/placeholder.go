package artwork

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/big"
	"os"
	"path/filepath"
)

// PlaceholderGenerator creates retro-styled placeholder cover art
// when no real artwork is available.
type PlaceholderGenerator struct {
	cacheDir string
}

func NewPlaceholderGenerator(cacheDir string) *PlaceholderGenerator {
	return &PlaceholderGenerator{cacheDir: cacheDir}
}

// Generate creates a retro placeholder image as PNG data.
// The gradient colors are deterministically derived from artist+album name.
func (p *PlaceholderGenerator) Generate(artID, artistName, albumTitle string) ([]byte, error) {
	seed := artistName + "|" + albumTitle
	c1, c2 := paletteFromSeed(seed)

	const size = 600
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	// Draw vertical gradient
	for y := 0; y < size; y++ {
		t := float64(y) / float64(size)
		r := uint8(float64(c1.R)*(1-t) + float64(c2.R)*t)
		g := uint8(float64(c1.G)*(1-t) + float64(c2.G)*t)
		b := uint8(float64(c1.B)*(1-t) + float64(c2.B)*t)
		col := color.RGBA{R: r, G: g, B: b, A: 255}
		for x := 0; x < size; x++ {
			img.Set(x, y, col)
		}
	}

	// Draw a subtle dark vignette border for depth
	drawVignette(img, size)

	// Draw vinyl record decoration
	drawVinyl(img, size, c1)

	// Optionally cache to disk
	if p.cacheDir != "" {
		dir := filepath.Join(p.cacheDir, "placeholders")
		if err := os.MkdirAll(dir, 0755); err == nil {
			outPath := filepath.Join(dir, artID+".png")
			if f, err := os.Create(outPath); err == nil {
				defer f.Close()
				_ = png.Encode(f, img)
			}
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode placeholder: %w", err)
	}

	return buf.Bytes(), nil
}

// paletteFromSeed deterministically generates two retro neon colors from a string seed.
func paletteFromSeed(seed string) (color.RGBA, color.RGBA) {
	h := sha256.Sum256([]byte(seed))
	hash := hex.EncodeToString(h[:])

	// Use parts of the hash to pick from retro neon palettes
	palettes := [][2]color.RGBA{
		{{R: 20, G: 10, B: 40, A: 255}, {R: 180, G: 0, B: 255, A: 255}}, // deep purple → neon violet
		{{R: 10, G: 5, B: 30, A: 255}, {R: 0, G: 200, B: 255, A: 255}},  // near black → neon cyan
		{{R: 30, G: 0, B: 0, A: 255}, {R: 255, G: 60, B: 0, A: 255}},    // dark red → neon orange
		{{R: 5, G: 25, B: 5, A: 255}, {R: 0, G: 255, B: 100, A: 255}},   // dark green → neon green
		{{R: 30, G: 10, B: 0, A: 255}, {R: 255, G: 180, B: 0, A: 255}},  // dark amber → neon gold
		{{R: 20, G: 0, B: 30, A: 255}, {R: 255, G: 0, B: 150, A: 255}},  // dark → neon pink
		{{R: 0, G: 10, B: 30, A: 255}, {R: 30, G: 80, B: 255, A: 255}},  // dark navy → neon blue
		{{R: 30, G: 5, B: 20, A: 255}, {R: 200, G: 0, B: 80, A: 255}},   // dark maroon → neon crimson
	}

	// Pick palette from first byte of hash
	n := new(big.Int)
	n.SetString(hash[:2], 16)
	idx := int(n.Int64()) % len(palettes)

	return palettes[idx][0], palettes[idx][1]
}

func drawVignette(img *image.RGBA, size int) {
	center := float64(size) / 2
	maxDist := center * 1.2
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx := float64(x) - center
			dy := float64(y) - center
			dist := (dx*dx + dy*dy) / (maxDist * maxDist)
			if dist > 0.6 {
				alpha := uint8(200 * (dist - 0.6) / 0.4)
				existing := img.RGBAAt(x, y)
				r := uint8(float64(existing.R) * (1 - float64(alpha)/255))
				g := uint8(float64(existing.G) * (1 - float64(alpha)/255))
				b := uint8(float64(existing.B) * (1 - float64(alpha)/255))
				img.Set(x, y, color.RGBA{R: r, G: g, B: b, A: 255})
			}
		}
	}
}

func drawVinyl(img draw.Image, size int, accent color.RGBA) {
	cx := size / 2
	cy := size / 2

	// Outer ring — dark
	drawCircleOutline(img, cx, cy, size/2-10, color.RGBA{R: 20, G: 20, B: 20, A: 120}, 8)
	// Mid ring
	drawCircleOutline(img, cx, cy, size/4, color.RGBA{R: 40, G: 40, B: 40, A: 100}, 4)
	// Center label circle
	drawCircleFill(img, cx, cy, size/8, color.RGBA{R: accent.R / 3, G: accent.G / 3, B: accent.B / 3, A: 200})
	// Center hole
	drawCircleFill(img, cx, cy, 6, color.RGBA{R: 0, G: 0, B: 0, A: 255})
}

func drawCircleOutline(img draw.Image, cx, cy, r int, c color.RGBA, thickness int) {
	for t := 0; t < thickness; t++ {
		rr := r - t
		for angle := 0; angle < 360*10; angle++ {
			a := float64(angle) / 10 * (3.14159265 / 180)
			x := cx + int(float64(rr)*cos(a))
			y := cy + int(float64(rr)*sin(a))
			if x >= 0 && x < img.Bounds().Max.X && y >= 0 && y < img.Bounds().Max.Y {
				img.Set(x, y, c)
			}
		}
	}
}

func drawCircleFill(img draw.Image, cx, cy, r int, c color.RGBA) {
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			dx := x - cx
			dy := y - cy
			if dx*dx+dy*dy <= r*r {
				if x >= 0 && x < img.Bounds().Max.X && y >= 0 && y < img.Bounds().Max.Y {
					img.Set(x, y, c)
				}
			}
		}
	}
}

// Simple sin/cos approximations without math import to keep it lightweight.
func sin(x float64) float64 {
	// Taylor series approximation for small angles - use standard library instead
	// Actually let's just use a lookup approach
	return sinApprox(x)
}

func cos(x float64) float64 {
	return sinApprox(x + 1.5707963)
}

func sinApprox(x float64) float64 {
	// Normalize to [-π, π]
	for x > 3.14159265 {
		x -= 2 * 3.14159265
	}
	for x < -3.14159265 {
		x += 2 * 3.14159265
	}
	// Bhaskara I approximation
	if x >= 0 {
		return 16 * x * (3.14159265 - x) / (5*3.14159265*3.14159265 - 4*x*(3.14159265-x))
	}
	return -sinApprox(-x)
}
