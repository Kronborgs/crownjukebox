package musicbrainz

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// cdSuffixRe matches trailing " - CD N" / " - Disc N" / " - Disk N" patterns.
// Used to clean up album titles before sending them to MusicBrainz.
var cdSuffixRe = regexp.MustCompile(`(?i)\s*[-–]\s*(?:CD|Disc|Disk)\s*\d+\s*$`)

// StripCDSuffix removes a trailing disc-indicator suffix from an album title.
// Examples:
//
//	"Gold - CD 2"          → "Gold"
//	"A Little South - CD1" → "A Little South"
//	"Shu-bi-dua - deluxe"  → "Shu-bi-dua - deluxe"  (unchanged)
func StripCDSuffix(title string) string {
	cleaned := strings.TrimSpace(cdSuffixRe.ReplaceAllString(title, ""))
	if cleaned == "" {
		return title
	}
	return cleaned
}

const apiBase = "https://musicbrainz.org/ws/2"

// userAgent must identify the application per MusicBrainz API policy.
const userAgent = "CrownJukebox/1.0 (https://github.com/Kronborgs/crownjukebox)"

// rateLimiter enforces the MusicBrainz 1 request/second limit.
var (
	rateMu   sync.Mutex
	lastCall time.Time
)

func rateLimit() {
	rateMu.Lock()
	defer rateMu.Unlock()
	if since := time.Since(lastCall); since < time.Second {
		time.Sleep(time.Second - since)
	}
	lastCall = time.Now()
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// ArtistCredit is one entry in the artist-credit array.
type ArtistCredit struct {
	Name   string `json:"name"`
	Artist struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"artist"`
}

// ReleaseGroup is a MusicBrainz release-group (corresponds to an album concept).
type ReleaseGroup struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	PrimaryType    string         `json:"primary-type"`
	SecondaryTypes []string       `json:"secondary-types"`
	ArtistCredit   []ArtistCredit `json:"artist-credit"`
	Score          int            `json:"score"`
}

// ArtistName returns the canonical album-artist string for a release group.
// For compilations it returns "Various Artists".
func (rg *ReleaseGroup) ArtistName() string {
	for _, ac := range rg.ArtistCredit {
		if ac.Name != "" {
			return ac.Name
		}
		if ac.Artist.Name != "" {
			return ac.Artist.Name
		}
	}
	return ""
}

// IsCompilation reports whether this release group is tagged as a compilation.
func (rg *ReleaseGroup) IsCompilation() bool {
	for _, st := range rg.SecondaryTypes {
		if st == "Compilation" {
			return true
		}
	}
	return false
}

type searchResponse struct {
	ReleaseGroups []ReleaseGroup `json:"release-groups"`
	Count         int            `json:"count"`
}

// SearchReleaseGroups searches MusicBrainz for release groups by title and optional artist.
// When artist is non-empty the query is narrowed to `artist:"X" AND releasegroup:"Y"`,
// which dramatically improves precision for generic album titles like "Gold", "Greatest Hits".
//
// The title is automatically cleaned: trailing " - CD N" / " - Disc N" suffixes are
// stripped so "Gold - CD 2" searches as "Gold".
//
// It tries two strategies and merges results:
//  1. Exact phrase search (quoted) — high precision
//  2. Tokenised/fuzzy search — better recall for titles with numbers
//
// Returns up to 8 deduplicated results ordered by relevance score.
func SearchReleaseGroups(title, artist string) ([]ReleaseGroup, error) {
	cleanTitle := StripCDSuffix(title)

	var exactQ, fuzzyQ string
	if artist != "" {
		exactQ = fmt.Sprintf(`artist:"%s" AND releasegroup:"%s"`, artist, cleanTitle)
		fuzzyQ = fmt.Sprintf(`artist:%s AND releasegroup:%s`,
			url.QueryEscape(artist), url.QueryEscape(cleanTitle))
	} else {
		exactQ = fmt.Sprintf(`releasegroup:"%s"`, cleanTitle)
		fuzzyQ = fmt.Sprintf(`releasegroup:%s`, url.QueryEscape(cleanTitle))
	}

	exact, err := searchMB(exactQ, 5)
	if err != nil {
		return nil, err
	}

	// Always also do a fuzzy pass so we catch near-matches.
	rateLimit()
	fuzzy, err2 := searchMB(fuzzyQ, 5)
	if err2 == nil {
		seen := make(map[string]bool, len(exact))
		for _, r := range exact {
			seen[r.ID] = true
		}
		for _, r := range fuzzy {
			if !seen[r.ID] {
				exact = append(exact, r)
			}
		}
	}

	// Cap at 8 results.
	if len(exact) > 8 {
		exact = exact[:8]
	}
	return exact, nil
}

func searchMB(query string, limit int) ([]ReleaseGroup, error) {
	rateLimit()

	q := url.QueryEscape(query)
	reqURL := fmt.Sprintf("%s/release-group?query=%s&limit=%d&fmt=json", apiBase, q, limit)

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("musicbrainz request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("musicbrainz returned %d", resp.StatusCode)
	}

	var result searchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result.ReleaseGroups, nil
}
