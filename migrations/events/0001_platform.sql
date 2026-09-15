-- New Events D1 only. Never apply to the existing FIRST SEAT database.
PRAGMA foreign_keys = ON;
CREATE TABLE events (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 visibility TEXT NOT NULL DEFAULT 'draft' CHECK(visibility IN('draft','published','archived')),
 draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
 published_json TEXT CHECK(published_json IS NULL OR json_valid(published_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), activity_revision INTEGER NOT NULL DEFAULT 0, current_stage_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(id,current_stage_id) REFERENCES event_stages(event_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE event_stages (
 event_id TEXT NOT NULL REFERENCES events(id), id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('submission','voting','result')), title TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0),
 accepting INTEGER NOT NULL DEFAULT 0 CHECK(accepting IN(0,1)),
 starts_at INTEGER, ends_at INTEGER, round INTEGER NOT NULL DEFAULT 1 CHECK(round>0),
 allow_repeat INTEGER NOT NULL DEFAULT 0 CHECK(allow_repeat IN(0,1)),
 max_length INTEGER NOT NULL DEFAULT 30 CHECK(max_length BETWEEN 1 AND 1000),
 PRIMARY KEY(event_id,id), UNIQUE(event_id,position),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE platform_admins (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), created_at INTEGER NOT NULL
);
CREATE TABLE platform_sessions (
 token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES platform_admins(id),
 csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE event_policies (
 event_id TEXT NOT NULL REFERENCES events(id), id TEXT NOT NULL, kind TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), body TEXT NOT NULL, digest TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(event_id,id), UNIQUE(event_id,kind,version)
);
CREATE TABLE stage_policies (
 event_id TEXT NOT NULL, stage_id TEXT NOT NULL, kind TEXT NOT NULL, policy_id TEXT NOT NULL,
 required INTEGER NOT NULL CHECK(required IN(0,1)), PRIMARY KEY(event_id,stage_id,kind),
 FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id),
 FOREIGN KEY(event_id,policy_id) REFERENCES event_policies(event_id,id)
);
CREATE TABLE event_entries (
 event_id TEXT NOT NULL, id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','candidate')),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
 PRIMARY KEY(event_id,id), FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id)
);
CREATE TABLE event_candidates (
 event_id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL, id TEXT NOT NULL,
 entry_id TEXT, message TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN(0,1)),
 PRIMARY KEY(event_id,stage_id,round,id), UNIQUE(event_id,stage_id,round,position),
 FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id),
 FOREIGN KEY(event_id,entry_id) REFERENCES event_entries(event_id,id)
);
CREATE TABLE event_votes (
 event_id TEXT NOT NULL, id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 candidate_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(event_id,id),
 FOREIGN KEY(event_id,stage_id,round,candidate_id) REFERENCES event_candidates(event_id,stage_id,round,id)
);
CREATE TABLE event_participants (
 event_id TEXT NOT NULL, id TEXT NOT NULL, entry_id TEXT, vote_id TEXT,
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json)), key_version TEXT NOT NULL,
 masked_json TEXT NOT NULL CHECK(json_valid(masked_json)), retention_until INTEGER NOT NULL,
 PRIMARY KEY(event_id,id), UNIQUE(event_id,entry_id), UNIQUE(event_id,vote_id),
 CHECK((entry_id IS NOT NULL)+(vote_id IS NOT NULL)=1),
 FOREIGN KEY(event_id,entry_id) REFERENCES event_entries(event_id,id),
 FOREIGN KEY(event_id,vote_id) REFERENCES event_votes(event_id,id)
);
CREATE TABLE event_consents (
 event_id TEXT NOT NULL, participant_id TEXT NOT NULL, policy_id TEXT NOT NULL, accepted_at INTEGER NOT NULL,
 PRIMARY KEY(event_id,participant_id,policy_id),
 FOREIGN KEY(event_id,participant_id) REFERENCES event_participants(event_id,id),
 FOREIGN KEY(event_id,policy_id) REFERENCES event_policies(event_id,id)
);
-- Every accepted vote retains normalized identity HMACs, including repeat-allowed votes.
-- Unique claims are acquired only when repeat voting is prohibited.
CREATE TABLE event_vote_identities (
 event_id TEXT NOT NULL, vote_id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 field TEXT NOT NULL CHECK(field IN('phone','email','instagram')), identity_hmac TEXT NOT NULL, key_version TEXT NOT NULL,
 PRIMARY KEY(event_id,vote_id,field),
 FOREIGN KEY(event_id,vote_id) REFERENCES event_votes(event_id,id),
 FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id)
);
CREATE TABLE event_identity_claims (
 event_id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 field TEXT NOT NULL, identity_hmac TEXT NOT NULL, vote_id TEXT NOT NULL,
 PRIMARY KEY(event_id,stage_id,round,field,identity_hmac),
 FOREIGN KEY(event_id,vote_id) REFERENCES event_votes(event_id,id)
);
CREATE TABLE event_results (
 event_id TEXT NOT NULL, stage_id TEXT NOT NULL, voting_stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 candidate_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(event_id,stage_id),
 FOREIGN KEY(event_id,stage_id) REFERENCES event_stages(event_id,id),
 FOREIGN KEY(event_id,voting_stage_id,round,candidate_id) REFERENCES event_candidates(event_id,stage_id,round,id)
);
CREATE TABLE event_requests (
 event_id TEXT NOT NULL REFERENCES events(id), stage_id TEXT NOT NULL, round INTEGER NOT NULL,
 request_key TEXT NOT NULL, payload_hmac TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 expires_at INTEGER NOT NULL, PRIMARY KEY(event_id,stage_id,round,request_key)
);
CREATE TABLE event_rate_limits (
 event_id TEXT NOT NULL REFERENCES events(id), subject_hmac TEXT NOT NULL, window INTEGER NOT NULL,
 count INTEGER NOT NULL CHECK(count>=0), PRIMARY KEY(event_id,subject_hmac,window)
);
CREATE TABLE event_audit (
 id TEXT PRIMARY KEY, event_id TEXT REFERENCES events(id), admin_id TEXT REFERENCES platform_admins(id),
 action TEXT NOT NULL, target_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
 created_at INTEGER NOT NULL
);
CREATE TABLE event_reset_tokens (
 token_hash TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 admin_id TEXT NOT NULL REFERENCES platform_admins(id), expected_revision INTEGER NOT NULL,
 expected_activity INTEGER NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), expires_at INTEGER NOT NULL
);
CREATE INDEX entries_review ON event_entries(event_id,status,created_at);
CREATE INDEX votes_tally ON event_votes(event_id,stage_id,round,candidate_id);
CREATE INDEX participants_expiry ON event_participants(retention_until);
CREATE INDEX identity_lookup ON event_vote_identities(event_id,stage_id,round,field,identity_hmac);
CREATE INDEX event_audit_time ON event_audit(event_id,created_at);
CREATE TRIGGER policy_no_update BEFORE UPDATE ON event_policies BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER policy_no_delete BEFORE DELETE ON event_policies BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON event_audit BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON event_audit BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER entry_gate BEFORE INSERT ON event_entries BEGIN
 SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM events e JOIN event_stages s ON s.event_id=e.id AND s.id=e.current_stage_id
 WHERE e.id=NEW.event_id AND e.visibility='published' AND s.id=NEW.stage_id
 AND s.kind='submission' AND s.accepting=1 AND s.round=NEW.round
 AND (s.starts_at IS NULL OR s.starts_at<=unixepoch()*1000)
 AND (s.ends_at IS NULL OR s.ends_at>unixepoch()*1000)
 ) THEN RAISE(ABORT,'ENTRY_CLOSED') END;
END;
CREATE TRIGGER vote_gate BEFORE INSERT ON event_votes BEGIN
 SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM events e JOIN event_stages s ON s.event_id=e.id AND s.id=e.current_stage_id
 JOIN event_candidates c ON c.event_id=s.event_id AND c.stage_id=s.id AND c.round=s.round
 WHERE e.id=NEW.event_id AND e.visibility='published' AND s.id=NEW.stage_id
 AND s.kind='voting' AND s.accepting=1 AND s.round=NEW.round AND c.id=NEW.candidate_id AND c.confirmed=1
 AND (s.starts_at IS NULL OR s.starts_at<=unixepoch()*1000)
 AND (s.ends_at IS NULL OR s.ends_at>unixepoch()*1000)
 ) THEN RAISE(ABORT,'VOTE_CLOSED') END;
END;
-- Used inside atomic D1 batches to reject stale revisions without partial writes.
CREATE TABLE event_operation_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));

CREATE TRIGGER event_entries_insert_activity AFTER INSERT ON event_entries BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_entries_update_activity AFTER UPDATE ON event_entries BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_entries_delete_activity AFTER DELETE ON event_entries BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_votes_insert_activity AFTER INSERT ON event_votes BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_votes_update_activity AFTER UPDATE ON event_votes BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_votes_delete_activity AFTER DELETE ON event_votes BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_candidates_insert_activity AFTER INSERT ON event_candidates BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_candidates_update_activity AFTER UPDATE ON event_candidates BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_candidates_delete_activity AFTER DELETE ON event_candidates BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_results_insert_activity AFTER INSERT ON event_results BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_results_update_activity AFTER UPDATE ON event_results BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_results_delete_activity AFTER DELETE ON event_results BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_participants_insert_activity AFTER INSERT ON event_participants BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_participants_update_activity AFTER UPDATE ON event_participants BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_participants_delete_activity AFTER DELETE ON event_participants BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_consents_insert_activity AFTER INSERT ON event_consents BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_consents_update_activity AFTER UPDATE ON event_consents BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_consents_delete_activity AFTER DELETE ON event_consents BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;

CREATE TRIGGER event_identity_claims_insert_activity AFTER INSERT ON event_identity_claims BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_identity_claims_update_activity AFTER UPDATE ON event_identity_claims BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=NEW.event_id; END;

CREATE TRIGGER event_identity_claims_delete_activity AFTER DELETE ON event_identity_claims BEGIN UPDATE events SET activity_revision=activity_revision+1 WHERE id=OLD.event_id; END;
