-- Remove album rows that have no tracks.
-- These are artefacts from compilation rescans where the scanner created a
-- per-artist album row for each track on a compilation CD (e.g. "Dance Chart
-- Winter/Spring 2012"). Migration 004 already deduped once; this migration
-- cleans up any new empty rows created by rescans before the scanner fix
-- (scanner.go upsertAlbum now uses title+year fallback unconditionally).
DELETE FROM albums
WHERE source_type != 'party_upload'
  AND (SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id) = 0;
