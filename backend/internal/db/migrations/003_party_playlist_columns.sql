-- 003_party_playlist_columns.sql
-- Adds is_intro and position columns to playlist_tracks for proper SKÅL sequencing.

-- Add is_intro flag so each track in a party playlist can be marked as "intro" 
-- (played first, in order) or non-intro (random pick after intros finish).
ALTER TABLE playlist_tracks ADD COLUMN is_intro INTEGER NOT NULL DEFAULT 0;
