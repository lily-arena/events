-- Anonymous page-view counters; no IP, visitor identity or participant data.
CREATE TABLE event_monitoring_state (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 tracking_started_at INTEGER NOT NULL
);
INSERT INTO event_monitoring_state SELECT id,unixepoch()*1000 FROM events;
CREATE TRIGGER event_monitoring_created AFTER INSERT ON events BEGIN
 INSERT INTO event_monitoring_state VALUES(NEW.id,unixepoch()*1000);
END;
CREATE TABLE event_pageview_receipts (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 visit_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(event_id,visit_id)
);
CREATE INDEX pageview_receipts_expiry ON event_pageview_receipts(created_at);
CREATE TABLE event_pageviews (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 bucket INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(event_id,bucket)
);
CREATE TRIGGER event_pageview_count AFTER INSERT ON event_pageview_receipts BEGIN
 INSERT INTO event_pageviews(event_id,bucket,views) VALUES(NEW.event_id,CAST(NEW.created_at/900000 AS INTEGER)*900000,1)
 ON CONFLICT(event_id,bucket) DO UPDATE SET views=views+1;
END;
CREATE INDEX monitoring_entries ON event_entries(event_id,created_at);
CREATE INDEX monitoring_votes ON event_votes(event_id,created_at);
