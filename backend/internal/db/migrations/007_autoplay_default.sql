-- 007_autoplay_default.sql
-- Seed autoplay_enabled=true as default and re-seed keyboard bindings defaults

-- Add autoplay_enabled setting with default true (INSERT OR IGNORE preserves any existing value)
INSERT OR IGNORE INTO settings (key, value) VALUES ('autoplay_enabled', 'true');

-- Re-seed keyboard bindings: INSERT OR IGNORE won't overwrite existing rows, but this
-- ensures any missing bindings are created in case the DB was migrated without them.
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
