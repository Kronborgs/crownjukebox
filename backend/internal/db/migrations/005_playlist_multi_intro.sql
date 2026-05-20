-- 005_playlist_multi_intro.sql
-- Adds is_intro flag on playlist_tracks to support multiple ordered intro tracks.
-- The intro tracks play in position order; remaining tracks are pooled for random pick.

ALTER TABLE playlist_tracks ADD COLUMN is_intro INTEGER NOT NULL DEFAULT 0;

-- Migrate existing single intro_track_id to the new is_intro flag
UPDATE playlist_tracks
SET is_intro = 1
WHERE (playlist_id, track_id) IN (
    SELECT pt.playlist_id, pt.track_id
    FROM playlist_tracks pt
    JOIN playlists pl ON pl.id = pt.playlist_id
    WHERE pl.intro_track_id IS NOT NULL
      AND pt.track_id = pl.intro_track_id
);
