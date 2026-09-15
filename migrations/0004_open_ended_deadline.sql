-- 마감 일정을 비워두면 수동으로 종료할 때까지 계속 진행되어야 한다.
-- 기존 trigger는 마감 시각이 반드시 있다고 보고 NULL과 비교해 모든 접수·투표를 막았다.
-- 시작 시각도 비어 있을 수 있으므로 함께 허용한다.

DROP TRIGGER IF EXISTS submission_gate;
CREATE TRIGGER submission_gate BEFORE INSERT ON submissions BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.state='SUBMISSION_OPEN'
   AND c.paused=0 AND c.launch_approved=1 AND c.revision=NEW.config_revision
   AND (c.submission_start IS NULL OR CAST(strftime('%s','now') AS INTEGER)*1000>=c.submission_start)
   AND (c.submission_end IS NULL OR CAST(strftime('%s','now') AS INTEGER)*1000<c.submission_end)
   AND NEW.grapheme_count<=c.max_message_length
 ) THEN RAISE(ABORT,'SUBMISSION_GATE') END;
END;

DROP TRIGGER IF EXISTS vote_gate;
CREATE TRIGGER vote_gate BEFORE INSERT ON votes BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c JOIN candidate_sets cs ON cs.campaign_id=c.id
   JOIN anonymous_sessions a ON a.id=NEW.voter_session_id
  WHERE c.id=NEW.campaign_id AND c.state='VOTING_OPEN' AND c.paused=0 AND c.launch_approved=1
   AND c.voting_epoch=NEW.epoch AND cs.id=NEW.set_id AND cs.epoch=NEW.epoch AND cs.status='FROZEN'
   AND a.purpose='VOTER' AND a.campaign_id=c.id AND a.epoch=NEW.epoch
   AND a.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
   AND (c.voting_start IS NULL OR CAST(strftime('%s','now') AS INTEGER)*1000>=c.voting_start)
   AND (c.voting_end IS NULL OR CAST(strftime('%s','now') AS INTEGER)*1000<c.voting_end)
 ) THEN RAISE(ABORT,'VOTE_GATE') END;
END;
