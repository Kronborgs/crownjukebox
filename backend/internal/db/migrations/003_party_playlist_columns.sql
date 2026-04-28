-- 003_party_playlist_columns.sql
-- Adds is_intro flag to playlist_tracks (idempotent — safe if column already exists).
ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS is_intro INTEGER NOT NULL DEFAULT 0;
