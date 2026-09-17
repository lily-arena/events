ALTER TABLE event_entries ADD COLUMN review_comment TEXT NOT NULL DEFAULT '';
ALTER TABLE event_entries ADD COLUMN comment_revision INTEGER NOT NULL DEFAULT 0;
