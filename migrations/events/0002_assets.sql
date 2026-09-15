CREATE TABLE event_assets (
 event_id TEXT NOT NULL REFERENCES events(id), id TEXT NOT NULL,
 content_base64 TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 30 AND 196608),
 mime TEXT NOT NULL CHECK(mime='image/webp'), created_at INTEGER NOT NULL,
 PRIMARY KEY(event_id,id)
);
