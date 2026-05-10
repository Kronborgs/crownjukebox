-- 013_player_roles.sql
-- Phase 1: Guest session flag (QR guests may not play audio)
-- Phase 2: Active player session per room
-- Phase 3: Audio state (volume, balance, tone, mute) per room

-- Mark sessions created via QR access-link login so frontend can block audio.
ALTER TABLE sessions ADD COLUMN is_guest_session INTEGER NOT NULL DEFAULT 0;

-- Active player session: only this session may initialise the audio element.
ALTER TABLE rooms ADD COLUMN active_player_session_id TEXT;

-- Per-room audio state synced in real-time across all owner devices.
ALTER TABLE rooms ADD COLUMN volume      INTEGER NOT NULL DEFAULT 80;
ALTER TABLE rooms ADD COLUMN balance     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN tone_bass   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN tone_mid    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN tone_treble INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN is_muted    INTEGER NOT NULL DEFAULT 0;
