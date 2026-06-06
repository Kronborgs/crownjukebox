-- Add a dedicated "Tilbage til albumliste" keyboard binding.
-- Default key: Home — already hardcoded in the frontend, now surfaced in
-- the admin settings so it can be remapped.
INSERT OR IGNORE INTO keyboard_bindings (action, key_code, label)
VALUES ('back_to_albums', 'Home', 'Tilbage til albumliste');
