-- 010_jukebox_url.sql
-- Adds jukebox_url setting: the public-facing URL used in invitation emails and QR links.
-- e.g. https://jukeboxen.kronborgs.dk
INSERT OR IGNORE INTO settings (key, value) VALUES ('jukebox_url', '');
