-- Add loudness (bass enhancement) flag to per-room audio settings
ALTER TABLE rooms ADD COLUMN loudness INTEGER NOT NULL DEFAULT 0;
