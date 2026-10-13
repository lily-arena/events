-- Milliseconds since Unix epoch. NULL means not yet observed / cannot be established.
ALTER TABLE events ADD COLUMN started_at INTEGER;
ALTER TABLE events ADD COLUMN ended_at INTEGER;
-- Explicit operator correction; automatic transition history remains unchanged.
ALTER TABLE events ADD COLUMN ended_at_override INTEGER;
