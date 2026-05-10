package external

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// YouTubeSearchResult is one video returned by the YouTube Data API v3.
type YouTubeSearchResult struct {
	VideoID      string `json:"video_id"`
	Title        string `json:"title"`
	ChannelName  string `json:"channel_name"`
	ThumbnailURL string `json:"thumbnail_url"`
}

type ytSearchResponse struct {
	Items []struct {
		ID struct {
			VideoID string `json:"videoId"`
		} `json:"id"`
		Snippet struct {
			Title        string `json:"title"`
			ChannelTitle string `json:"channelTitle"`
			Thumbnails   struct {
				Medium struct {
					URL string `json:"url"`
				} `json:"medium"`
				Default struct {
					URL string `json:"url"`
				} `json:"default"`
			} `json:"thumbnails"`
		} `json:"snippet"`
	} `json:"items"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// SearchYouTube calls the YouTube Data API v3 and returns up to 10 results.
// Returns an error if apiKey is empty or the API responds with an error.
func SearchYouTube(apiKey, query string) ([]YouTubeSearchResult, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("YouTube API-nøgle mangler — konfigurér den i Admin → YouTube")
	}

	params := url.Values{
		"key":        {apiKey},
		"q":          {query},
		"part":       {"snippet"},
		"type":       {"video"},
		"maxResults": {"10"},
	}
	resp, err := http.Get("https://www.googleapis.com/youtube/v3/search?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("youtube api request: %w", err)
	}
	defer resp.Body.Close()

	var yt ytSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&yt); err != nil {
		return nil, fmt.Errorf("decode youtube response: %w", err)
	}
	if yt.Error != nil {
		return nil, fmt.Errorf("youtube api error %d: %s", yt.Error.Code, yt.Error.Message)
	}

	results := make([]YouTubeSearchResult, 0, len(yt.Items))
	for _, item := range yt.Items {
		if item.ID.VideoID == "" {
			continue
		}
		thumb := item.Snippet.Thumbnails.Medium.URL
		if thumb == "" {
			thumb = item.Snippet.Thumbnails.Default.URL
		}
		results = append(results, YouTubeSearchResult{
			VideoID:      item.ID.VideoID,
			Title:        item.Snippet.Title,
			ChannelName:  item.Snippet.ChannelTitle,
			ThumbnailURL: thumb,
		})
	}
	return results, nil
}
