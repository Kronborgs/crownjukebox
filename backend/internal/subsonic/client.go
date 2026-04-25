package subsonic

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client is a minimal Subsonic API client with cover art support.
type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
	clientName string
	version    string
}

// NewClient creates a new Subsonic API client.
func NewClient(baseURL, username, password string) *Client {
	return &Client{
		baseURL:  baseURL,
		username: username,
		password: password,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		clientName: "CrownJukebox",
		version:    "1.16.0",
	}
}

// subsonicResponse wraps the standard Subsonic JSON response envelope.
type subsonicResponse struct {
	SubsonicResponse struct {
		Status  string `json:"status"`
		Version string `json:"version"`
		Error   *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
		Artists   *ArtistsResult   `json:"artists,omitempty"`
		Album     *Album           `json:"album,omitempty"`
		Albums    *AlbumList2      `json:"albumList2,omitempty"`
		Playlists *PlaylistsResult `json:"playlists,omitempty"`
		Playlist  *PlaylistResult  `json:"playlist,omitempty"`
	} `json:"subsonic-response"`
}

// ─── Domain types ────────────────────────────────────────────

type Artist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CoverArt   string `json:"coverArt,omitempty"`
	AlbumCount int    `json:"albumCount"`
}

type Album struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ArtistID  string `json:"artistId"`
	Artist    string `json:"artist"`
	CoverArt  string `json:"coverArt,omitempty"`
	SongCount int    `json:"songCount"`
	Year      int    `json:"year,omitempty"`
	Genre     string `json:"genre,omitempty"`
	Songs     []Song `json:"song,omitempty"`
}

type Song struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Album      string `json:"album,omitempty"`
	Artist     string `json:"artist,omitempty"`
	ArtistID   string `json:"artistId,omitempty"`
	AlbumID    string `json:"albumId,omitempty"`
	CoverArt   string `json:"coverArt,omitempty"`
	Duration   int    `json:"duration"`
	Track      int    `json:"track,omitempty"`
	DiscNumber int    `json:"discNumber,omitempty"`
	Year       int    `json:"year,omitempty"`
	Genre      string `json:"genre,omitempty"`
	Suffix     string `json:"suffix,omitempty"`
}

type ArtistsResult struct {
	Index []struct {
		Name   string   `json:"name"`
		Artist []Artist `json:"artist"`
	} `json:"index"`
}

type AlbumList2 struct {
	Album []Album `json:"album"`
}

type PlaylistsResult struct {
	Playlist []PlaylistSummary `json:"playlist"`
}

type PlaylistSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SongCount int    `json:"songCount"`
	CoverArt  string `json:"coverArt,omitempty"`
}

type PlaylistResult struct {
	PlaylistSummary
	Entry []Song `json:"entry"`
}

// ─── API methods ─────────────────────────────────────────────

// Ping verifies connectivity to the Subsonic server.
func (c *Client) Ping() error {
	_, err := c.get("ping", nil)
	return err
}

// GetArtists returns all artists from the Subsonic library.
func (c *Client) GetArtists() ([]Artist, error) {
	resp, err := c.get("getArtists", nil)
	if err != nil {
		return nil, err
	}

	var result subsonicResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse artists: %w", err)
	}

	if result.SubsonicResponse.Artists == nil {
		return nil, nil
	}

	var artists []Artist
	for _, idx := range result.SubsonicResponse.Artists.Index {
		artists = append(artists, idx.Artist...)
	}
	return artists, nil
}

// GetAlbums returns albums sorted by type (e.g. "alphabeticalByName").
func (c *Client) GetAlbums(sortType string, count, offset int) ([]Album, error) {
	if sortType == "" {
		sortType = "alphabeticalByName"
	}
	resp, err := c.get("getAlbumList2", url.Values{
		"type":   {sortType},
		"size":   {fmt.Sprintf("%d", count)},
		"offset": {fmt.Sprintf("%d", offset)},
	})
	if err != nil {
		return nil, err
	}

	var result subsonicResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse albums: %w", err)
	}

	if result.SubsonicResponse.Albums == nil {
		return nil, nil
	}
	return result.SubsonicResponse.Albums.Album, nil
}

// GetAlbum returns a single album with its tracks.
func (c *Client) GetAlbum(albumID string) (*Album, error) {
	resp, err := c.get("getAlbum", url.Values{"id": {albumID}})
	if err != nil {
		return nil, err
	}

	var result subsonicResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse album: %w", err)
	}
	return result.SubsonicResponse.Album, nil
}

// GetPlaylists returns all playlists.
func (c *Client) GetPlaylists() ([]PlaylistSummary, error) {
	resp, err := c.get("getPlaylists", nil)
	if err != nil {
		return nil, err
	}

	var result subsonicResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse playlists: %w", err)
	}

	if result.SubsonicResponse.Playlists == nil {
		return nil, nil
	}
	return result.SubsonicResponse.Playlists.Playlist, nil
}

// GetPlaylist returns a playlist with its tracks.
func (c *Client) GetPlaylist(playlistID string) (*PlaylistResult, error) {
	resp, err := c.get("getPlaylist", url.Values{"id": {playlistID}})
	if err != nil {
		return nil, err
	}

	var result subsonicResponse
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse playlist: %w", err)
	}
	return result.SubsonicResponse.Playlist, nil
}

// GetCoverArt streams cover art for a given coverArt ID.
// Returns the raw image bytes and content-type.
func (c *Client) GetCoverArt(coverArtID string, size int) ([]byte, string, error) {
	params := url.Values{"id": {coverArtID}}
	if size > 0 {
		params.Set("size", fmt.Sprintf("%d", size))
	}

	reqURL := c.buildURL("getCoverArt", params)
	resp, err := c.httpClient.Get(reqURL)
	if err != nil {
		return nil, "", fmt.Errorf("get cover art: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("cover art request failed: %s", resp.Status)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // max 10MB
	if err != nil {
		return nil, "", fmt.Errorf("read cover art: %w", err)
	}

	return data, resp.Header.Get("Content-Type"), nil
}

// StreamURL returns the URL to stream a song.
func (c *Client) StreamURL(songID string) string {
	return c.buildURL("stream", url.Values{"id": {songID}})
}

// ─── Internal helpers ────────────────────────────────────────

func (c *Client) get(endpoint string, params url.Values) ([]byte, error) {
	reqURL := c.buildURL(endpoint, params)

	resp, err := c.httpClient.Get(reqURL)
	if err != nil {
		return nil, fmt.Errorf("subsonic %s request: %w", endpoint, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", endpoint, err)
	}

	var wrapper subsonicResponse
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if wrapper.SubsonicResponse.Status != "ok" {
		if wrapper.SubsonicResponse.Error != nil {
			return nil, fmt.Errorf("subsonic error %d: %s",
				wrapper.SubsonicResponse.Error.Code,
				wrapper.SubsonicResponse.Error.Message)
		}
		return nil, fmt.Errorf("subsonic returned non-ok status")
	}

	return body, nil
}

func (c *Client) buildURL(endpoint string, params url.Values) string {
	if params == nil {
		params = url.Values{}
	}
	params.Set("u", c.username)
	params.Set("p", c.password)
	params.Set("v", c.version)
	params.Set("c", c.clientName)
	params.Set("f", "json")

	return fmt.Sprintf("%s/rest/%s?%s", c.baseURL, endpoint, params.Encode())
}
