-- Migration 015: Deduplicate artists and albums using case-insensitive name/title comparison.
-- Fixes cases like "Music Is Taking Over" vs "Music is Taking Over" or "Remady" vs "REMADY"
-- being stored as separate rows because the previous scanner used case-sensitive SQL comparisons.

-- ─── Step 1: Deduplicate artists ────────────────────────────────────────────

-- Build a mapping from every artist id to the canonical artist id.
-- Canon = the artist row with the most tracks; ties broken by most albums, then lowest id.
CREATE TEMPORARY TABLE _artist_ci_canon AS
SELECT
  a.id AS dup_id,
  (
    SELECT a2.id
    FROM artists a2
    WHERE LOWER(a2.name) = LOWER(a.name)
    ORDER BY
      (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = a2.id) DESC,
      (SELECT COUNT(*) FROM albums al WHERE al.artist_id = a2.id) DESC,
      a2.id ASC
    LIMIT 1
  ) AS canon_id
FROM artists a;

-- Reassign albums.artist_id to the canonical artist
UPDATE albums
SET artist_id = (SELECT canon_id FROM _artist_ci_canon WHERE dup_id = albums.artist_id)
WHERE artist_id IN (SELECT dup_id FROM _artist_ci_canon WHERE dup_id != canon_id);

-- Reassign albums.album_artist_id to the canonical artist (nullable column)
UPDATE albums
SET album_artist_id = (SELECT canon_id FROM _artist_ci_canon WHERE dup_id = albums.album_artist_id)
WHERE album_artist_id IS NOT NULL
  AND album_artist_id IN (SELECT dup_id FROM _artist_ci_canon WHERE dup_id != canon_id);

-- Reassign tracks.artist_id to the canonical artist
UPDATE tracks
SET artist_id = (SELECT canon_id FROM _artist_ci_canon WHERE dup_id = tracks.artist_id)
WHERE artist_id IN (SELECT dup_id FROM _artist_ci_canon WHERE dup_id != canon_id);

-- Delete duplicate artist rows
DELETE FROM artists
WHERE id IN (SELECT dup_id FROM _artist_ci_canon WHERE dup_id != canon_id);

DROP TABLE IF EXISTS _artist_ci_canon;

-- ─── Step 2: Deduplicate albums ─────────────────────────────────────────────

-- Now that artist IDs are normalised, find albums that share the same artist_id
-- and the same title (case-insensitive).  Keep the row with the most tracks;
-- ties broken by whether it already has cover art, then by lowest id.
-- We intentionally ignore source_type so that e.g. a 'local' duplicate of
-- another 'local' album is merged regardless of how the case ended up in the DB.
-- party_upload albums are excluded from being the merge target for local albums
-- (they can still be merged among themselves).

CREATE TEMPORARY TABLE _album_ci_canon AS
SELECT
  a.id AS dup_id,
  (
    SELECT a2.id
    FROM albums a2
    WHERE a2.artist_id    = a.artist_id
      AND LOWER(a2.title) = LOWER(a.title)
      AND a2.source_type  = a.source_type     -- keep source_type boundaries
    ORDER BY
      (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a2.id) DESC,
      (CASE WHEN a2.cover_art_id IS NOT NULL AND a2.cover_art_id != '' THEN 0 ELSE 1 END) ASC,
      a2.id ASC
    LIMIT 1
  ) AS canon_id
FROM albums a;

-- Reassign tracks from duplicate albums to the canonical album
UPDATE tracks
SET album_id = (SELECT canon_id FROM _album_ci_canon WHERE dup_id = tracks.album_id)
WHERE album_id IN (SELECT dup_id FROM _album_ci_canon WHERE dup_id != canon_id);

-- Delete now-empty duplicate album rows
DELETE FROM albums
WHERE id IN (SELECT dup_id FROM _album_ci_canon WHERE dup_id != canon_id);

DROP TABLE IF EXISTS _album_ci_canon;
