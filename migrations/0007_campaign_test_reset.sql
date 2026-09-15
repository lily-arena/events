-- Reset is permitted only inside the audited reset transaction.
CREATE TABLE campaign_reset_runs (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 actor_id TEXT NOT NULL REFERENCES administrators(id),
 expected_revision INTEGER NOT NULL,
 resulting_revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','DONE'))
);
DROP TRIGGER decision_delete_denied;
CREATE TRIGGER decision_delete_denied BEFORE DELETE ON vote_decisions
WHEN NOT EXISTS (
 SELECT 1 FROM campaign_reset_runs r JOIN votes v ON v.campaign_id=r.campaign_id
 WHERE v.id=OLD.vote_id AND r.status='RUNNING'
)
BEGIN SELECT RAISE(ABORT,'DECISION_IMMUTABLE'); END;
