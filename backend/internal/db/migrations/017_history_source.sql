-- Add a source column to playback_history so we can distinguish:
--   'USER'     — track was manually chosen by a user
--   'AUTOPLAY' — track was selected by the autoplay engine
--   'PARTY'    — track was played as part of a Skål (party) sequence
--
-- This prevents autoplay from creating a self-reinforcing genre loop:
-- only USER-source tracks influence genre selection in AutoplayNext().

ALTER TABLE playback_history ADD COLUMN source TEXT NOT NULL DEFAULT 'USER';

-- Backfill existing Skål tracks using the was_party flag that already exists.
UPDATE playback_history SET source = 'PARTY' WHERE was_party = 1;
