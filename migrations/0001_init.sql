-- FIRST SEAT build contract v3.0. D1 / SQLite. No remote execution authorized.
-- Time is Unix milliseconds. D1 production triggers use database time.
PRAGMA foreign_keys = ON;
CREATE TABLE administrators (
 id TEXT PRIMARY KEY, access_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), created_at INTEGER NOT NULL
);
CREATE TABLE admin_roles (
 admin_id TEXT NOT NULL REFERENCES administrators(id),
 role TEXT NOT NULL CHECK(role IN('REVIEWER','OPERATOR','PII_OFFICER','OWNER','AUDITOR')),
 PRIMARY KEY(admin_id,role)
);
CREATE TABLE approvals (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, payload_digest TEXT NOT NULL,
 maker_id TEXT NOT NULL REFERENCES administrators(id), checker_id TEXT NOT NULL REFERENCES administrators(id),
 approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, CHECK(maker_id<>checker_id), CHECK(expires_at>approved_at)
);
CREATE TABLE campaigns (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','SUBMISSION_OPEN','SUBMISSION_CLOSED','VOTING_READY','VOTING_OPEN','VOTING_CLOSED','RESULT_READY','RESULT_PUBLISHED','ARCHIVED')),
 paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1)), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 max_message_length INTEGER NOT NULL DEFAULT 30 CHECK(max_message_length BETWEEN 1 AND 100),
 submission_start INTEGER, submission_end INTEGER, voting_start INTEGER, voting_end INTEGER,
 voting_epoch INTEGER NOT NULL DEFAULT 0 CHECK(voting_epoch>=0),
 absolute_pii_deadline INTEGER, launch_approved INTEGER NOT NULL DEFAULT 0 CHECK(launch_approved IN(0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(submission_end IS NULL OR submission_start<submission_end),
 CHECK(voting_end IS NULL OR voting_start<voting_end)
);
CREATE TABLE campaign_revisions (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id), revision INTEGER NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json)), digest TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES administrators(id), approval_id TEXT REFERENCES approvals(id), created_at INTEGER NOT NULL,
 PRIMARY KEY(campaign_id,revision)
);
CREATE TABLE policy_documents (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 kind TEXT NOT NULL CHECK(kind IN('PRIVACY','WORK_LICENSE','OVERSEAS','VOTE_PRIVACY','NOTICE_SUBMISSION','NOTICE_VOTING','ELIGIBILITY')),
 version INTEGER NOT NULL CHECK(version>0), body TEXT NOT NULL, digest TEXT NOT NULL,
 approval_id TEXT REFERENCES approvals(id), effective_at INTEGER, created_at INTEGER NOT NULL,
 UNIQUE(campaign_id,kind,version)
);
CREATE TABLE campaign_policies (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id), kind TEXT NOT NULL,
 policy_id TEXT NOT NULL REFERENCES policy_documents(id), required INTEGER NOT NULL CHECK(required IN(0,1)),
 PRIMARY KEY(campaign_id,kind)
);
CREATE TABLE anonymous_sessions (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 purpose TEXT NOT NULL CHECK(purpose IN('SUBMISSION','VOTER')), epoch INTEGER NOT NULL DEFAULT 0,
 token_hash TEXT NOT NULL UNIQUE, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 CHECK(expires_at>issued_at), UNIQUE(id,campaign_id,epoch)
);
CREATE TABLE submissions (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 config_revision INTEGER NOT NULL, message TEXT NOT NULL CHECK(length(message)>0),
 grapheme_count INTEGER NOT NULL CHECK(grapheme_count>0), accepted_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 reviewer_note TEXT NOT NULL DEFAULT '' CHECK(length(reviewer_note)<=2000),
 reviewer_id TEXT REFERENCES administrators(id), row_version INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(campaign_id,config_revision) REFERENCES campaign_revisions(campaign_id,revision)
);
CREATE TABLE pii_contacts (
 submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
 ciphertext BLOB NOT NULL, wrapped_dek BLOB NOT NULL, iv BLOB NOT NULL CHECK(length(iv)=12),
 key_version TEXT NOT NULL, aad_version INTEGER NOT NULL DEFAULT 1,
 masked_name TEXT NOT NULL, masked_phone TEXT NOT NULL, masked_email TEXT NOT NULL,
 retention_until INTEGER NOT NULL, purpose_completed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE consent_receipts (
 submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 policy_id TEXT NOT NULL REFERENCES policy_documents(id), accepted_at INTEGER NOT NULL,
 PRIMARY KEY(submission_id,policy_id)
);
CREATE TABLE candidate_sets (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), epoch INTEGER NOT NULL CHECK(epoch>0),
 revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','FROZEN','VOID')),
 digest TEXT, frozen_at INTEGER, approval_id TEXT REFERENCES approvals(id),
 rules_json TEXT NOT NULL CHECK(json_valid(rules_json)), created_by TEXT NOT NULL REFERENCES administrators(id),
 UNIQUE(campaign_id,epoch), UNIQUE(id,campaign_id,epoch)
);
CREATE TABLE candidates (
 id TEXT PRIMARY KEY, set_id TEXT NOT NULL, campaign_id TEXT NOT NULL, epoch INTEGER NOT NULL,
 source_submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
 public_message TEXT NOT NULL, public_number INTEGER NOT NULL CHECK(public_number>0),
 display_order INTEGER NOT NULL CHECK(display_order>=0), rights_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(rights_confirmed IN(0,1)),
 FOREIGN KEY(set_id,campaign_id,epoch) REFERENCES candidate_sets(id,campaign_id,epoch),
 UNIQUE(set_id,public_number), UNIQUE(set_id,display_order), UNIQUE(id,set_id,campaign_id,epoch)
);
CREATE TABLE votes (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), epoch INTEGER NOT NULL,
 set_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 voter_session_id TEXT REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
 accepted_at INTEGER NOT NULL,
 initial_review_state TEXT NOT NULL CHECK(initial_review_state IN('INCLUDED','PENDING')),
 FOREIGN KEY(candidate_id,set_id,campaign_id,epoch) REFERENCES candidates(id,set_id,campaign_id,epoch),
 UNIQUE(campaign_id,epoch,voter_session_id)
);
CREATE TABLE vote_risk_signals (
 vote_id TEXT PRIMARY KEY REFERENCES votes(id), ip_hmac TEXT NOT NULL, key_version TEXT NOT NULL,
 client_class TEXT NOT NULL, reasons_json TEXT NOT NULL CHECK(json_valid(reasons_json)), expires_at INTEGER NOT NULL
);
CREATE TABLE vote_decisions (
 id TEXT PRIMARY KEY, vote_id TEXT NOT NULL REFERENCES votes(id), version INTEGER NOT NULL CHECK(version>0),
 verdict TEXT NOT NULL CHECK(verdict IN('INCLUDED','EXCLUDED')),
 reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES administrators(id),
 approval_id TEXT NOT NULL REFERENCES approvals(id), created_at INTEGER NOT NULL, UNIQUE(vote_id,version)
);
CREATE TABLE jury_scores (
 set_id TEXT NOT NULL REFERENCES candidate_sets(id), candidate_id TEXT NOT NULL REFERENCES candidates(id),
 juror_id TEXT NOT NULL REFERENCES administrators(id), score_basis_points INTEGER NOT NULL CHECK(score_basis_points BETWEEN 0 AND 10000),
 criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)), row_version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 PRIMARY KEY(set_id,candidate_id,juror_id)
);
CREATE TABLE result_versions (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), epoch INTEGER NOT NULL,
 version INTEGER NOT NULL, set_id TEXT NOT NULL REFERENCES candidate_sets(id),
 winner_candidate_id TEXT NOT NULL REFERENCES candidates(id),
 tally_json TEXT NOT NULL CHECK(json_valid(tally_json)), scores_json TEXT NOT NULL CHECK(json_valid(scores_json)),
 set_digest TEXT NOT NULL, tally_digest TEXT NOT NULL, rationale TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','PUBLISHED','SUPERSEDED')),
 maker_id TEXT NOT NULL REFERENCES administrators(id), approval_id TEXT REFERENCES approvals(id),
 published_at INTEGER, correction_note TEXT, created_at INTEGER NOT NULL,
 UNIQUE(campaign_id,version)
);
CREATE TABLE result_media (
 id TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES result_versions(id),
 asset_path TEXT NOT NULL, alt_text TEXT NOT NULL, caption TEXT NOT NULL, display_order INTEGER NOT NULL,
 approved_by TEXT NOT NULL REFERENCES administrators(id), UNIQUE(result_id,display_order)
);
CREATE TABLE admin_sessions (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES administrators(id), session_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE reveal_grants (
 id TEXT PRIMARY KEY, admin_session_id TEXT NOT NULL REFERENCES admin_sessions(id),
 submission_id TEXT NOT NULL REFERENCES submissions(id), nonce_hash TEXT NOT NULL UNIQUE,
 reason TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
 CHECK(expires_at>created_at)
);
CREATE TABLE idempotency_records (
 scope TEXT NOT NULL, session_hash TEXT NOT NULL, key_hash TEXT NOT NULL,
 request_hmac TEXT NOT NULL, resource_id TEXT NOT NULL, http_status INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(scope,session_hash,key_hash)
);
CREATE TABLE rate_buckets (
 scope TEXT NOT NULL, subject_hmac TEXT NOT NULL, window_start INTEGER NOT NULL,
 count INTEGER NOT NULL CHECK(count>=0), expires_at INTEGER NOT NULL,
 PRIMARY KEY(scope,subject_hmac,window_start)
);
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
 occurred_at INTEGER NOT NULL, source_envelope BLOB, reason TEXT, outcome TEXT NOT NULL,
 request_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
 retention_until INTEGER NOT NULL
);
CREATE TABLE audit_outbox (
 event_id TEXT PRIMARY KEY REFERENCES audit_events(id), r2_key TEXT NOT NULL UNIQUE,
 delivered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, digest TEXT
);
CREATE TABLE deletion_jobs (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), target_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('CONTACT','SUBMISSION','VOTER','RISK','AUDIT','CONSENT')),
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','INTENT_ARCHIVED','DELETED','VERIFIED','FAILED')),
 due_at INTEGER NOT NULL, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
 UNIQUE(campaign_id,target_id,kind)
);
CREATE TABLE deletion_ledger (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES deletion_jobs(id), event TEXT NOT NULL,
 occurred_at INTEGER NOT NULL, restore_residue_until INTEGER NOT NULL, r2_key TEXT, archived_at INTEGER
);
CREATE TABLE job_cursors (name TEXT PRIMARY KEY, cursor TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE operation_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE transition_events (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), from_state TEXT NOT NULL, to_state TEXT NOT NULL,
 expected_revision INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES administrators(id),
 approval_id TEXT REFERENCES approvals(id), reason TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE INDEX submissions_review ON submissions(campaign_id,status,accepted_at,id);
CREATE INDEX pii_expiry ON pii_contacts(retention_until,submission_id);
CREATE INDEX sessions_expiry ON anonymous_sessions(expires_at,id);
CREATE INDEX votes_tally ON votes(campaign_id,epoch,candidate_id);
CREATE INDEX risks_expiry ON vote_risk_signals(expires_at,vote_id);
CREATE INDEX risks_ip ON vote_risk_signals(ip_hmac,vote_id);
CREATE INDEX audit_time ON audit_events(occurred_at,id);
CREATE INDEX audit_target ON audit_events(target_type,target_id,occurred_at);
CREATE INDEX outbox_pending ON audit_outbox(delivered_at,event_id);
CREATE INDEX idempotency_expiry ON idempotency_records(expires_at);
CREATE INDEX buckets_expiry ON rate_buckets(expires_at);
CREATE INDEX deletion_due ON deletion_jobs(state,due_at,id);

CREATE TRIGGER submission_gate BEFORE INSERT ON submissions BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.state='SUBMISSION_OPEN'
   AND c.paused=0 AND c.launch_approved=1 AND c.revision=NEW.config_revision
   AND CAST(strftime('%s','now') AS INTEGER)*1000>=c.submission_start
   AND CAST(strftime('%s','now') AS INTEGER)*1000<c.submission_end
   AND NEW.grapheme_count<=c.max_message_length
 ) THEN RAISE(ABORT,'SUBMISSION_GATE') END;
END;
CREATE TRIGGER vote_gate BEFORE INSERT ON votes BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN candidate_sets cs ON cs.campaign_id=c.id
   JOIN anonymous_sessions a ON a.id=NEW.voter_session_id
  WHERE c.id=NEW.campaign_id AND c.state='VOTING_OPEN' AND c.paused=0 AND c.launch_approved=1
   AND c.voting_epoch=NEW.epoch AND cs.id=NEW.set_id AND cs.epoch=NEW.epoch AND cs.status='FROZEN'
   AND a.purpose='VOTER' AND a.campaign_id=c.id AND a.epoch=NEW.epoch
   AND a.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
   AND CAST(strftime('%s','now') AS INTEGER)*1000>=c.voting_start
   AND CAST(strftime('%s','now') AS INTEGER)*1000<c.voting_end
 ) THEN RAISE(ABORT,'VOTE_GATE') END;
END;
CREATE TRIGGER candidate_insert_gate BEFORE INSERT ON candidates BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM candidate_sets WHERE id=NEW.set_id AND status='DRAFT')
 THEN RAISE(ABORT,'SET_FROZEN') END;
END;
CREATE TRIGGER candidate_update_gate BEFORE UPDATE ON candidates
WHEN NEW.set_id<>OLD.set_id OR NEW.public_message<>OLD.public_message OR NEW.public_number<>OLD.public_number
 OR NEW.display_order<>OLD.display_order OR NEW.rights_confirmed<>OLD.rights_confirmed BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM candidate_sets WHERE id=OLD.set_id AND status='DRAFT')
 THEN RAISE(ABORT,'SET_FROZEN') END;
END;
CREATE TRIGGER candidate_delete_gate BEFORE DELETE ON candidates BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM candidate_sets WHERE id=OLD.set_id AND status='DRAFT')
 THEN RAISE(ABORT,'SET_FROZEN') END;
END;
CREATE TRIGGER freeze_gate BEFORE UPDATE OF status ON candidate_sets WHEN NEW.status='FROZEN' BEGIN
 SELECT CASE WHEN OLD.status<>'DRAFT' OR NEW.approval_id IS NULL OR NEW.digest IS NULL OR NEW.frozen_at IS NULL
 OR (SELECT count(*) FROM candidates WHERE set_id=NEW.id) NOT BETWEEN 2 AND 12
 OR EXISTS(SELECT 1 FROM candidates WHERE set_id=NEW.id AND rights_confirmed=0)
 THEN RAISE(ABORT,'FREEZE_GATE') END;
END;
CREATE TRIGGER transition_gate BEFORE INSERT ON transition_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND state=NEW.from_state AND revision=NEW.expected_revision)
 THEN RAISE(ABORT,'REVISION_CONFLICT') END;
 SELECT CASE WHEN NOT (
  (NEW.from_state='DRAFT' AND NEW.to_state='SUBMISSION_OPEN') OR
  (NEW.from_state='SUBMISSION_OPEN' AND NEW.to_state='SUBMISSION_CLOSED') OR
  (NEW.from_state='SUBMISSION_CLOSED' AND NEW.to_state='VOTING_READY') OR
  (NEW.from_state='VOTING_READY' AND NEW.to_state='VOTING_OPEN') OR
  (NEW.from_state='VOTING_OPEN' AND NEW.to_state='VOTING_CLOSED') OR
  (NEW.from_state='VOTING_CLOSED' AND NEW.to_state='RESULT_READY') OR
  (NEW.from_state='RESULT_READY' AND NEW.to_state='RESULT_PUBLISHED') OR
  (NEW.from_state='RESULT_PUBLISHED' AND NEW.to_state='ARCHIVED')
 ) THEN RAISE(ABORT,'ILLEGAL_TRANSITION') END;
END;
CREATE TRIGGER transition_apply AFTER INSERT ON transition_events BEGIN
 UPDATE campaigns SET state=NEW.to_state, revision=revision+1, updated_at=NEW.occurred_at WHERE id=NEW.campaign_id;
END;
CREATE TRIGGER audit_update_denied BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_delete_gate BEFORE DELETE ON audit_events BEGIN
 SELECT CASE WHEN OLD.retention_until>CAST(strftime('%s','now') AS INTEGER)*1000
 OR EXISTS(SELECT 1 FROM audit_outbox WHERE event_id=OLD.id AND delivered_at IS NULL)
 THEN RAISE(ABORT,'AUDIT_RETENTION') END;
END;
CREATE TRIGGER decision_update_denied BEFORE UPDATE ON vote_decisions BEGIN SELECT RAISE(ABORT,'DECISION_IMMUTABLE'); END;
CREATE TRIGGER decision_delete_denied BEFORE DELETE ON vote_decisions BEGIN SELECT RAISE(ABORT,'DECISION_IMMUTABLE'); END;
CREATE TRIGGER policy_approved_immutable BEFORE UPDATE ON policy_documents WHEN OLD.approval_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

-- Page content is versioned separately from operational state and legal documents.
CREATE TABLE content_versions (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 page TEXT NOT NULL CHECK(page IN('SUBMISSION','SUBMITTED','VOTING','VOTED','WAITING','RESULT')),
 locale TEXT NOT NULL DEFAULT 'ko' CHECK(locale IN('ko','en')),
 version INTEGER NOT NULL CHECK(version>0),
 body_json TEXT NOT NULL CHECK(json_valid(body_json)), digest TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','PUBLISHED','SUPERSEDED')),
 legal_change INTEGER NOT NULL DEFAULT 0 CHECK(legal_change IN(0,1)),
 policy_refs_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(policy_refs_json)),
 maker_id TEXT NOT NULL REFERENCES administrators(id), approval_id TEXT REFERENCES approvals(id),
 row_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(campaign_id,page,locale,version), UNIQUE(id,campaign_id,page,locale)
);
CREATE TABLE content_publications (
 campaign_id TEXT NOT NULL, page TEXT NOT NULL, locale TEXT NOT NULL,
 content_version_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 published_by TEXT NOT NULL REFERENCES administrators(id), published_at INTEGER NOT NULL,
 FOREIGN KEY(content_version_id,campaign_id,page,locale) REFERENCES content_versions(id,campaign_id,page,locale),
 PRIMARY KEY(campaign_id,page,locale)
);
ALTER TABLE submissions ADD COLUMN content_version_id TEXT REFERENCES content_versions(id);
CREATE TRIGGER content_immutable BEFORE UPDATE ON content_versions
WHEN OLD.status<>'DRAFT' AND (NEW.body_json<>OLD.body_json OR NEW.digest<>OLD.digest OR NEW.policy_refs_json<>OLD.policy_refs_json)
BEGIN SELECT RAISE(ABORT,'CONTENT_IMMUTABLE'); END;
CREATE TRIGGER publication_insert_gate BEFORE INSERT ON content_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.id=NEW.content_version_id AND v.status IN('APPROVED','PUBLISHED','SUPERSEDED') AND v.approval_id IS NOT NULL)
 THEN RAISE(ABORT,'CONTENT_NOT_APPROVED') END;
END;
CREATE TRIGGER publication_update_gate BEFORE UPDATE ON content_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.id=NEW.content_version_id AND v.status IN('APPROVED','PUBLISHED','SUPERSEDED') AND v.approval_id IS NOT NULL)
 THEN RAISE(ABORT,'CONTENT_NOT_APPROVED') END;
END;
CREATE TABLE session_policy_receipts (
 session_id TEXT NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
 policy_id TEXT NOT NULL REFERENCES policy_documents(id), accepted_at INTEGER NOT NULL,
 PRIMARY KEY(session_id,policy_id)
);
ALTER TABLE votes ADD COLUMN content_version_id TEXT REFERENCES content_versions(id);
CREATE TRIGGER policy_receipt_campaign_gate BEFORE INSERT ON consent_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM submissions s JOIN policy_documents p ON p.campaign_id=s.campaign_id WHERE s.id=NEW.submission_id AND p.id=NEW.policy_id)
 THEN RAISE(ABORT,'POLICY_CAMPAIGN_MISMATCH') END;
END;
CREATE TRIGGER set_frozen_payload BEFORE UPDATE ON candidate_sets
WHEN OLD.status IN('FROZEN','VOID') AND (NEW.rules_json<>OLD.rules_json OR NEW.digest IS NOT OLD.digest OR NEW.campaign_id<>OLD.campaign_id OR NEW.epoch<>OLD.epoch OR NEW.revision<>OLD.revision)
BEGIN SELECT RAISE(ABORT,'SET_IMMUTABLE'); END;
CREATE TRIGGER vote_update_guard BEFORE UPDATE ON votes
WHEN NEW.candidate_id<>OLD.candidate_id OR NEW.campaign_id<>OLD.campaign_id OR NEW.epoch<>OLD.epoch
 OR NEW.set_id<>OLD.set_id OR NEW.accepted_at<>OLD.accepted_at OR NEW.initial_review_state<>OLD.initial_review_state
 OR NEW.voter_session_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'VOTE_IMMUTABLE'); END;
CREATE TRIGGER candidate_identity_guard BEFORE UPDATE ON candidates
WHEN NEW.campaign_id<>OLD.campaign_id OR NEW.epoch<>OLD.epoch OR NEW.id<>OLD.id
BEGIN SELECT RAISE(ABORT,'CANDIDATE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER set_status_gate BEFORE UPDATE OF status ON candidate_sets
WHEN NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='FROZEN') OR (OLD.status='FROZEN' AND NEW.status='VOID'))
BEGIN SELECT RAISE(ABORT,'SET_STATUS_GATE'); END;
CREATE TRIGGER candidate_source_gate BEFORE UPDATE OF source_submission_id ON candidates
WHEN NEW.source_submission_id IS NOT NULL AND NEW.source_submission_id IS NOT OLD.source_submission_id
 AND NOT EXISTS(SELECT 1 FROM candidate_sets WHERE id=OLD.set_id AND status='DRAFT')
BEGIN SELECT RAISE(ABORT,'SET_FROZEN'); END;
CREATE TRIGGER revision_update_denied BEFORE UPDATE ON campaign_revisions BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE TRIGGER approval_update_denied BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT,'APPROVAL_IMMUTABLE'); END;
