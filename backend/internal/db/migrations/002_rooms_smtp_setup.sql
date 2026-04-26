-- 002_rooms_smtp_setup.sql
-- Adds multi-room support, SMTP config, setup wizard flag, and invitation email field on users.

-- ─── Rooms ─────────────────────────────────────────────────────
-- Each room has its own queue, playback state, and party playlist.
CREATE TABLE IF NOT EXISTS rooms (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    party_playlist_id TEXT REFERENCES playlists(id),
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create the default room (migrates any existing data)
INSERT OR IGNORE INTO rooms (id, name) VALUES ('default', 'Hoved-scene');

-- ─── Per-room playback state ────────────────────────────────────
-- Replaces the single-row playback_state table with one row per room.
CREATE TABLE IF NOT EXISTS room_playback_state (
    room_id          TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    current_track_id TEXT REFERENCES tracks(id),
    is_playing       INTEGER NOT NULL DEFAULT 0,
    is_party_mode    INTEGER NOT NULL DEFAULT 0,
    party_track_id   TEXT REFERENCES tracks(id),
    position_seconds REAL NOT NULL DEFAULT 0,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing playback state to default room
INSERT OR IGNORE INTO room_playback_state (
    room_id, current_track_id, is_playing, is_party_mode,
    party_track_id, position_seconds, updated_at
)
SELECT 'default', current_track_id, is_playing, is_party_mode,
       party_track_id, position_seconds, updated_at
FROM playback_state WHERE id = 1;

-- ─── Add room_id to queue_items ─────────────────────────────────
-- SQLite doesn't support ADD COLUMN with FK, so we add without constraint.
ALTER TABLE queue_items ADD COLUMN room_id TEXT NOT NULL DEFAULT 'default';

-- ─── Add room_id to playback_history ───────────────────────────
ALTER TABLE playback_history ADD COLUMN room_id TEXT NOT NULL DEFAULT 'default';

-- ─── Add email to users (for invitation emails) ─────────────────
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';

-- ─── SMTP settings ─────────────────────────────────────────────
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('smtp_enabled',  '0'),
    ('smtp_host',     ''),
    ('smtp_port',     '587'),
    ('smtp_username', ''),
    ('smtp_password', ''),
    ('smtp_from',     ''),
    ('smtp_from_name', 'CrownJukebox');

-- ─── Setup wizard flag ─────────────────────────────────────────
-- '0' = setup not yet completed, '1' = setup done
INSERT OR IGNORE INTO settings (key, value) VALUES ('setup_completed', '0');

-- Mark existing installations as already set up (they already have an admin)
UPDATE settings SET value = '1' WHERE key = 'setup_completed'
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');

-- ─── Migrate party_playlist_id from global settings to default room ─
UPDATE rooms SET party_playlist_id = (
    SELECT value FROM settings WHERE key = 'party_playlist_id' AND value != ''
) WHERE id = 'default';
