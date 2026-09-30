-- No plaintext Instagram usernames: members contain the existing scoped identity HMAC.
CREATE TABLE event_follower_imports (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 id TEXT NOT NULL, admin_id TEXT NOT NULL REFERENCES platform_admins(id),
 stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 previous_id TEXT, status TEXT NOT NULL CHECK(status IN ('uploading','active','obsolete')),
 export_date TEXT, created_at INTEGER NOT NULL, applied_at INTEGER,
 PRIMARY KEY(event_id,id),
 FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX follower_active ON event_follower_imports(event_id) WHERE status='active';
CREATE TABLE event_follower_chunks (
 event_id TEXT NOT NULL, import_id TEXT NOT NULL, position INTEGER NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(event_id,import_id,position),
 FOREIGN KEY(event_id,import_id) REFERENCES event_follower_imports(event_id,id) ON DELETE CASCADE
);
CREATE TABLE event_follower_members (
 event_id TEXT NOT NULL, import_id TEXT NOT NULL, identity_hmac TEXT NOT NULL,
 PRIMARY KEY(event_id,import_id,identity_hmac),
 FOREIGN KEY(event_id,import_id) REFERENCES event_follower_imports(event_id,id) ON DELETE CASCADE
);
-- Resetting an event invalidates the round-scoped comparison data as well.
CREATE TRIGGER follower_round_reset AFTER UPDATE OF round ON event_stages
 WHEN OLD.round<>NEW.round BEGIN
 DELETE FROM event_follower_imports WHERE event_id=NEW.event_id AND stage_id=NEW.id;
END;
