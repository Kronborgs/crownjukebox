-- Auto DJ settings stored per-room (same pattern as volume/loudness).
-- Defaults: off, 12s crossfade, tempo-match off, max 6% adjustment.
ALTER TABLE rooms ADD COLUMN auto_dj_enabled          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN crossfade_seconds        INTEGER NOT NULL DEFAULT 12;
ALTER TABLE rooms ADD COLUMN tempo_match_enabled      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN max_tempo_adjust_percent INTEGER NOT NULL DEFAULT 6;
