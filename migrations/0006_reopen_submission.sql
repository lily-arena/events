-- Preserve all entries, votes and results when returning to submission.
DROP TRIGGER transition_gate;
CREATE TRIGGER transition_gate BEFORE INSERT ON transition_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND state=NEW.from_state AND revision=NEW.expected_revision)
 THEN RAISE(ABORT,'REVISION_CONFLICT') END;
 SELECT CASE WHEN NOT (
  (NEW.from_state IN ('DRAFT','SUBMISSION_CLOSED','VOTING_READY','VOTING_OPEN','VOTING_CLOSED','RESULT_READY','RESULT_PUBLISHED','ARCHIVED') AND NEW.to_state='SUBMISSION_OPEN') OR
  (NEW.from_state='SUBMISSION_OPEN' AND NEW.to_state='SUBMISSION_CLOSED') OR
  (NEW.from_state='SUBMISSION_CLOSED' AND NEW.to_state='VOTING_READY') OR
  (NEW.from_state='VOTING_READY' AND NEW.to_state='VOTING_OPEN') OR
  (NEW.from_state='VOTING_OPEN' AND NEW.to_state='VOTING_CLOSED') OR
  (NEW.from_state='VOTING_CLOSED' AND NEW.to_state='RESULT_READY') OR
  (NEW.from_state='RESULT_READY' AND NEW.to_state='RESULT_PUBLISHED') OR
  (NEW.from_state='RESULT_PUBLISHED' AND NEW.to_state='ARCHIVED')
 ) THEN RAISE(ABORT,'ILLEGAL_TRANSITION') END;
END;
