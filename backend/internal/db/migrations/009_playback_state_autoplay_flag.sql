-- 009_playback_state_autoplay_flag.sql
-- Persist is_autoplay_track so the flag survives container restarts.
-- Without this, all tracks appear as non-autoplay after a restart,
-- so user queue additions don't trigger the skip-autoplay logic.

ALTER TABLE room_playback_state ADD COLUMN is_autoplay_track INTEGER NOT NULL DEFAULT 0;
