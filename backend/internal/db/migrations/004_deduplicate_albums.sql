-- 004_deduplicate_albums.sql
-- Deduplicate album rows that share the same title and source_type.
-- Keeps the "canonical" album — the one with the most tracks; if tied,
-- prefers the one that has cover art; finally falls back to the smallest id.
-- All tracks belonging to duplicates are reassigned to the canonical album,
-- then the empty duplicate rows are deleted.

CREATE TEMPORARY TABLE IF NOT EXISTS _album_canon AS
SELECT
  a.id AS dup_id,
  (
    SELECT a2.id
    FROM albums a2
    WHERE a2.title       = a.title
      AND a2.source_type = a.source_type
    ORDER BY
      (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a2.id) DESC,
      (CASE WHEN a2.cover_art_id IS NOT NULL AND a2.cover_art_id != '' THEN 0 ELSE 1 END) ASC,
      a2.id ASC
    LIMIT 1
  ) AS canon_id
FROM albums a;

-- Reassign tracks that belong to non-canonical duplicates
UPDATE tracks
SET album_id = (
  SELECT canon_id FROM _album_canon WHERE dup_id = tracks.album_id
)
WHERE album_id IN (
  SELECT dup_id FROM _album_canon WHERE dup_id != canon_id
);

-- Remove the now-empty duplicate album rows
DELETE FROM albums
WHERE id IN (
  SELECT dup_id FROM _album_canon WHERE dup_id != canon_id
);

DROP TABLE IF EXISTS _album_canon;
