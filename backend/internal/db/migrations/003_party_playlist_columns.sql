-- 003_party_playlist_columns.sql
-- Adds is_intro flag to playlist_tracks.
ALTER TABLE playlist_tracks ADD COLUMN is_intro INTEGER NOT NULL DEFAULT 0;
