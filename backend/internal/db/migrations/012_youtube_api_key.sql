-- 012_youtube_api_key.sql
-- Stores the YouTube Data API v3 key in the settings table so it can be
-- configured via the admin panel instead of an environment variable.
INSERT OR IGNORE INTO settings (key, value) VALUES ('youtube_api_key', '');
