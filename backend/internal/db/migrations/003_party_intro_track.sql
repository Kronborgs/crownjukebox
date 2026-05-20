-- 003_party_intro_track.sql
-- Adds intro_track_id on playlists (the track that always plays first on Skål)
-- and a party_volume_boost setting.

ALTER TABLE playlists ADD COLUMN intro_track_id TEXT REFERENCES tracks(id);

INSERT OR IGNORE INTO settings (key, value) VALUES ('party_volume_boost', '15');
