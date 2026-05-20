-- 001_initial_schema.sql
-- Full initial schema for CrownJukebox

-- ─── Artists ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artists (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    sort_name      TEXT NOT NULL DEFAULT '',
    musicbrainz_id TEXT NOT NULL DEFAULT '',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Album Art ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS album_art (
    id                  TEXT PRIMARY KEY,
    album_id            TEXT,
    track_id            TEXT,
    source_type         TEXT NOT NULL, -- embedded | folder_file | subsonic | generated | external
    source_path         TEXT NOT NULL DEFAULT '',
    original_hash       TEXT NOT NULL UNIQUE,
    mime_type           TEXT NOT NULL DEFAULT 'image/jpeg',
    width               INTEGER NOT NULL DEFAULT 0,
    height              INTEGER NOT NULL DEFAULT 0,
    small_path          TEXT NOT NULL DEFAULT '',
    medium_path         TEXT NOT NULL DEFAULT '',
    large_path          TEXT NOT NULL DEFAULT '',
    color_palette_json  TEXT NOT NULL DEFAULT '[]',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Albums ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS albums (
    id              TEXT PRIMARY KEY,
    artist_id       TEXT NOT NULL DEFAULT '' REFERENCES artists(id),
    album_artist_id TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL,
    year            INTEGER NOT NULL DEFAULT 0,
    genre           TEXT NOT NULL DEFAULT '',
    source_type     TEXT NOT NULL DEFAULT 'local',
    source_id       TEXT NOT NULL DEFAULT '',
    cover_art_id    TEXT REFERENCES album_art(id),
    cover_status    TEXT NOT NULL DEFAULT 'missing',
    track_count     INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Tracks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    album_id     TEXT NOT NULL REFERENCES albums(id),
    artist_id    TEXT NOT NULL DEFAULT '' REFERENCES artists(id),
    title        TEXT NOT NULL,
    track_number INTEGER NOT NULL DEFAULT 0,
    disc_number  INTEGER NOT NULL DEFAULT 1,
    duration     INTEGER NOT NULL DEFAULT 0,
    file_path    TEXT NOT NULL DEFAULT '',
    source_type  TEXT NOT NULL DEFAULT 'local',
    source_id    TEXT NOT NULL DEFAULT '',
    stream_url   TEXT NOT NULL DEFAULT '',
    cover_art_id TEXT REFERENCES album_art(id),
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracks_album_id  ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);

-- ─── Playlists ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playlists (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    source_type      TEXT NOT NULL DEFAULT 'local',
    source_id        TEXT NOT NULL DEFAULT '',
    is_party_playlist INTEGER NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

-- ─── Users ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    username            TEXT UNIQUE,
    role                TEXT NOT NULL DEFAULT 'user',
    pin_hash            TEXT NOT NULL DEFAULT '',
    login_token_hash    TEXT NOT NULL DEFAULT '',
    is_active           INTEGER NOT NULL DEFAULT 1,
    is_permanent        INTEGER NOT NULL DEFAULT 0,
    access_starts_at    DATETIME,
    access_expires_at   DATETIME,
    created_by_admin_id TEXT REFERENCES users(id),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        DATETIME
);

-- ─── User Permissions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    can_add_to_queue     INTEGER NOT NULL DEFAULT 1,
    can_search           INTEGER NOT NULL DEFAULT 1,
    can_use_party_button INTEGER NOT NULL DEFAULT 0,
    can_view_queue       INTEGER NOT NULL DEFAULT 1
);

-- ─── Sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash TEXT NOT NULL UNIQUE,
    device_name        TEXT NOT NULL DEFAULT '',
    user_agent         TEXT NOT NULL DEFAULT '',
    ip_address         TEXT NOT NULL DEFAULT '',
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at         DATETIME NOT NULL,
    revoked_at         DATETIME,
    last_seen_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(session_token_hash);

-- ─── Access Links (QR login) ────────────────────────────────
CREATE TABLE IF NOT EXISTS access_links (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    used_at    DATETIME,
    revoked_at DATETIME
);

-- ─── Queue ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue_items (
    id               TEXT PRIMARY KEY,
    track_id         TEXT NOT NULL REFERENCES tracks(id),
    added_by_user_id TEXT REFERENCES users(id),
    position         INTEGER NOT NULL,
    is_autoplay      INTEGER NOT NULL DEFAULT 0,
    added_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Playback History ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS playback_history (
    id               TEXT PRIMARY KEY,
    track_id         TEXT NOT NULL REFERENCES tracks(id),
    played_by_user_id TEXT REFERENCES users(id),
    started_at       DATETIME NOT NULL,
    ended_at         DATETIME,
    was_skipped      INTEGER NOT NULL DEFAULT 0,
    was_party        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_history_started_at ON playback_history(started_at);

-- ─── Playback State (single row) ────────────────────────────
CREATE TABLE IF NOT EXISTS playback_state (
    id               INTEGER PRIMARY KEY DEFAULT 1,
    current_track_id TEXT REFERENCES tracks(id),
    is_playing       INTEGER NOT NULL DEFAULT 0,
    is_party_mode    INTEGER NOT NULL DEFAULT 0,
    party_track_id   TEXT REFERENCES tracks(id),
    position_seconds REAL NOT NULL DEFAULT 0,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO playback_state (id) VALUES (1);

-- ─── Settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('theme', 'retro-neon'),
    ('language', 'da'),
    ('party_playlist_id', ''),
    ('attract_mode_timeout_seconds', '120');

-- ─── Keyboard Bindings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyboard_bindings (
    action   TEXT PRIMARY KEY,
    key_code TEXT NOT NULL,
    label    TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO keyboard_bindings (action, key_code, label) VALUES
    ('play_pause',   'Space',      'Afspil/Pause'),
    ('next_page',    'ArrowRight', 'Næste side'),
    ('prev_page',    'ArrowLeft',  'Forrige side'),
    ('nav_up',       'ArrowUp',    'Op'),
    ('nav_down',     'ArrowDown',  'Ned'),
    ('select',       'Enter',      'Vælg'),
    ('back',         'Escape',     'Tilbage'),
    ('search',       'KeyS',       'Søg'),
    ('party',        'KeyP',       'SKÅL');

-- ─── Subsonic Config (single row) ───────────────────────────
CREATE TABLE IF NOT EXISTS subsonic_config (
    id            INTEGER PRIMARY KEY DEFAULT 1,
    url           TEXT NOT NULL DEFAULT '',
    username      TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    api_token     TEXT NOT NULL DEFAULT '',
    is_enabled    INTEGER NOT NULL DEFAULT 0,
    last_sync_at  DATETIME
);

INSERT OR IGNORE INTO subsonic_config (id) VALUES (1);
