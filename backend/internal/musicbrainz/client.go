package musicbrainz

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"
)

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

// SearchReleaseGroups searches MusicBrainz for release groups by title.
// Returns up to 5 results ordered by relevance score.
func SearchReleaseGroups(title string) ([]ReleaseGroup, error) {
	rateLimit()

	q := url.QueryEscape(fmt.Sprintf(`releasegroup:"%s"`, title))
	reqURL := fmt.Sprintf("%s/release-group?query=%s&limit=5&fmt=json", apiBase, q)

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
