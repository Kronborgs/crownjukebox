-- 004_rooms_per_user.sql
-- Changes room architecture: one room per user instead of shared rooms.
-- Each user's jukebox becomes their personal room.

-- Add owner_user_id to rooms to track which user owns each room
ALTER TABLE rooms ADD COLUMN owner_user_id TEXT REFERENCES users(id);

-- Mark default room as system-owned (no specific user)
UPDATE rooms SET owner_user_id = NULL WHERE id = 'default';

-- Create a room for each existing user (using their user_id as room_id)
INSERT OR IGNORE INTO rooms (id, name, owner_user_id, created_at)
SELECT 
    id,
    display_name || 's Jukebox',
    id,
    CURRENT_TIMESTAMP
FROM users;

-- Migrate existing queue_items and playback state from 'default' room to user-specific rooms
-- (This assumes existing queue items were added by specific users - we'll keep them in default for now)
-- In production, you might want to distribute these to specific users based on added_by_user_id

-- Create playback state for each user room
INSERT OR IGNORE INTO room_playback_state (room_id, is_playing, position_seconds, updated_at)
SELECT id, 0, 0, CURRENT_TIMESTAMP
FROM users;
