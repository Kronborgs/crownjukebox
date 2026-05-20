-- 008_normalize_autoplay_setting.sql
-- Normalize boolean autoplay_enabled value — case insensitive
-- This fixes databases where admin typed 'True' (capital T) in the text input

UPDATE settings
SET value = 'true'
WHERE key = 'autoplay_enabled'
  AND lower(trim(value)) IN ('true', 'yes', 'on', '1');

UPDATE settings
SET value = 'false'
WHERE key = 'autoplay_enabled'
  AND lower(trim(value)) IN ('false', 'no', 'off', '0');
