-- 담당자 한 명이 수정·후보 확정·공개 전환·최종 문구 확정까지 끝낼 수 있도록 제약을 정리한다.
-- 과거 승인·점수·권리 확인 기록은 이력으로 그대로 둔다. 새 작업이 그 값에 의존하지 않게만 바꾼다.
-- SQLite는 CHECK/trigger를 직접 고칠 수 없으므로 해당 표만 재생성한다.

/*
 * 안전장치.
 *
 * 이 migration은 submissions 등 부모 표를 다시 만든다.
 * D1은 실행 전체를 하나의 트랜잭션으로 감싸므로 트랜잭션 안에서 foreign_keys를 끌 수 없고,
 * DROP TABLE은 암묵적 DELETE를 수행해 ON DELETE CASCADE로 묶인 자식(개인정보 암호문·동의 기록)을 지운다.
 * 즉 데이터가 들어 있는 DB에서는 안전하지 않다.
 *
 * 그래서 응모 데이터가 있으면 아무것도 바꾸지 않고 전체를 되돌린다.
 * 빈 DB(신규 운영 DB)에서는 그대로 적용된다.
 * 앞으로 스키마를 바꿀 때는 부모 표 재생성 대신 ALTER TABLE ADD COLUMN 같은 덧붙이는 방식을 쓴다.
 * 검증: scripts/db-migration-upgrade-test.mjs
 */
CREATE TABLE migration_guard_0003 (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO migration_guard_0003(ok)
 SELECT CASE WHEN (SELECT COUNT(*) FROM submissions) = 0 THEN 1 ELSE 0 END;

PRAGMA defer_foreign_keys = true;

-- 다른 표에 붙어 있으면서 submissions를 조회하는 trigger는 잠시 내렸다가 그대로 복구한다.
DROP TRIGGER IF EXISTS policy_receipt_campaign_gate;
DROP TRIGGER IF EXISTS campaign_action_immutable;
DROP TRIGGER IF EXISTS campaign_action_status_gate;

-- 1) 심사 상태에 CANDIDATE를 추가한다. 검토 대기에서 바로 후보로 갈 수 있다.
CREATE TABLE submissions_new (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 config_revision INTEGER NOT NULL, message TEXT NOT NULL CHECK(length(message)>0),
 grapheme_count INTEGER NOT NULL CHECK(grapheme_count>0), accepted_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANDIDATE','WITHDRAWN')),
 reviewer_note TEXT NOT NULL DEFAULT '' CHECK(length(reviewer_note)<=2000),
 reviewer_id TEXT REFERENCES administrators(id), row_version INTEGER NOT NULL DEFAULT 1,
 content_version_id TEXT REFERENCES content_versions(id),
 -- 후보로 지정한 순서. 숏리스트 기본 정렬에 쓴다.
 candidate_order INTEGER,
 FOREIGN KEY(campaign_id,config_revision) REFERENCES campaign_revisions(campaign_id,revision)
);
INSERT INTO submissions_new
 (id, campaign_id, config_revision, message, grapheme_count, accepted_at, status, reviewer_note, reviewer_id, row_version, content_version_id, candidate_order)
SELECT id, campaign_id, config_revision, message, grapheme_count, accepted_at, status, reviewer_note, reviewer_id, row_version, content_version_id, NULL
  FROM submissions;

-- 기존 후보 set에 들어 있던 응모는 후보 상태로 잇는다. 표와의 연결은 candidates가 그대로 유지한다.
UPDATE submissions_new SET status = 'CANDIDATE'
 WHERE id IN (SELECT source_submission_id FROM candidates WHERE source_submission_id IS NOT NULL);
UPDATE submissions_new SET candidate_order = (
  SELECT MIN(c.display_order) FROM candidates c WHERE c.source_submission_id = submissions_new.id
) WHERE status = 'CANDIDATE';

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;
CREATE INDEX submissions_review ON submissions(campaign_id,status,accepted_at,id);
CREATE INDEX submissions_candidate ON submissions(campaign_id,status,candidate_order);

-- 접수 조건 trigger는 그대로 되살린다.
CREATE TRIGGER submission_gate BEFORE INSERT ON submissions BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.state='SUBMISSION_OPEN'
   AND c.paused=0 AND c.launch_approved=1 AND c.revision=NEW.config_revision
   AND CAST(strftime('%s','now') AS INTEGER)*1000>=c.submission_start
   AND CAST(strftime('%s','now') AS INTEGER)*1000<c.submission_end
   AND NEW.grapheme_count<=c.max_message_length
 ) THEN RAISE(ABORT,'SUBMISSION_GATE') END;
END;

-- 2) 후보 확정에서 권리 확인과 승인 요구를 없앤다.
DROP TRIGGER IF EXISTS freeze_gate;
CREATE TRIGGER freeze_gate BEFORE UPDATE OF status ON candidate_sets WHEN NEW.status='FROZEN' BEGIN
 SELECT CASE WHEN OLD.status<>'DRAFT' OR NEW.digest IS NULL OR NEW.frozen_at IS NULL
 OR (SELECT count(*) FROM candidates WHERE set_id=NEW.id) NOT BETWEEN 1 AND 12
 THEN RAISE(ABORT,'FREEZE_GATE') END;
END;

-- 2-1) 투표 시작 전에는 확정본을 다시 확정할 수 있어야 한다.
--      FROZEN → DRAFT 되돌리기를 허용하고, 투표 중 변경은 서비스 계층에서 막는다.
DROP TRIGGER IF EXISTS set_status_gate;
CREATE TRIGGER set_status_gate BEFORE UPDATE OF status ON candidate_sets
WHEN NOT (NEW.status=OLD.status
  OR (OLD.status='DRAFT' AND NEW.status='FROZEN')
  OR (OLD.status='FROZEN' AND NEW.status='DRAFT')
  OR (OLD.status='FROZEN' AND NEW.status='VOID'))
BEGIN SELECT RAISE(ABORT,'SET_STATUS_GATE'); END;

-- 2-2) 확정본을 다시 확정할 때 문구·순서가 바뀔 수 있어야 한다.
DROP TRIGGER IF EXISTS set_frozen_payload;
CREATE TRIGGER set_frozen_payload BEFORE UPDATE ON candidate_sets
WHEN OLD.status='VOID' AND (NEW.rules_json<>OLD.rules_json OR NEW.campaign_id<>OLD.campaign_id OR NEW.epoch<>OLD.epoch)
BEGIN SELECT RAISE(ABORT,'SET_IMMUTABLE'); END;

-- 2-3) 확정을 되돌린 뒤 후보를 교체할 수 있어야 한다.
DROP TRIGGER IF EXISTS candidate_insert_gate;
DROP TRIGGER IF EXISTS candidate_update_gate;
DROP TRIGGER IF EXISTS candidate_delete_gate;
CREATE TRIGGER candidate_insert_gate BEFORE INSERT ON candidates BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM candidate_sets WHERE id=NEW.set_id AND status IN('DRAFT','FROZEN'))
 THEN RAISE(ABORT,'SET_FROZEN') END;
END;
CREATE TRIGGER candidate_delete_gate BEFORE DELETE ON candidates BEGIN
 -- 이미 표를 받은 후보는 지울 수 없다. 표와의 연결을 지킨다.
 SELECT CASE WHEN EXISTS(SELECT 1 FROM votes WHERE candidate_id=OLD.id)
 THEN RAISE(ABORT,'CANDIDATE_HAS_VOTES') END;
END;

-- 3) 문구 게시에서 타인 승인 요구를 없앤다. 저장하면 바로 적용된다.
DROP TRIGGER IF EXISTS publication_insert_gate;
DROP TRIGGER IF EXISTS publication_update_gate;
CREATE TRIGGER publication_insert_gate BEFORE INSERT ON content_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.id=NEW.content_version_id)
 THEN RAISE(ABORT,'CONTENT_MISSING') END;
END;
CREATE TRIGGER publication_update_gate BEFORE UPDATE ON content_publications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.id=NEW.content_version_id)
 THEN RAISE(ABORT,'CONTENT_MISSING') END;
END;

-- 4) 결과는 수동 선택을 저장한다. 점수·선정 근거·집계 digest를 요구하지 않는다.
CREATE TABLE result_versions_new (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), epoch INTEGER NOT NULL,
 version INTEGER NOT NULL, set_id TEXT NOT NULL REFERENCES candidate_sets(id),
 winner_candidate_id TEXT NOT NULL REFERENCES candidates(id),
 tally_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(tally_json)),
 scores_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scores_json)),
 set_digest TEXT NOT NULL DEFAULT '', tally_digest TEXT NOT NULL DEFAULT '',
 -- 옛 선정 근거. 새 화면에서는 쓰지 않고 public에도 보내지 않는다.
 rationale TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','PUBLISHED','SUPERSEDED')),
 maker_id TEXT NOT NULL REFERENCES administrators(id), approval_id TEXT REFERENCES approvals(id),
 published_at INTEGER, correction_note TEXT, created_at INTEGER NOT NULL,
 -- 수동 선택임을 구분한다. 화면에는 노출하지 않는다.
 selection_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK(selection_mode IN('MANUAL','COMPUTED')),
 selected_by TEXT REFERENCES administrators(id), selected_at INTEGER,
 UNIQUE(campaign_id,version)
);
INSERT INTO result_versions_new
 (id, campaign_id, epoch, version, set_id, winner_candidate_id, tally_json, scores_json, set_digest, tally_digest,
  rationale, status, maker_id, approval_id, published_at, correction_note, created_at, selection_mode, selected_by, selected_at)
SELECT id, campaign_id, epoch, version, set_id, winner_candidate_id, tally_json, scores_json, set_digest, tally_digest,
       rationale, status, maker_id, approval_id, published_at, correction_note, created_at, 'COMPUTED', maker_id, created_at
  FROM result_versions;
DROP TABLE result_versions;
ALTER TABLE result_versions_new RENAME TO result_versions;

-- 5) 공개 전환은 한 담당자가 확인 한 번으로 실행한다. 요청자와 실행자가 달라야 한다는 조건을 없앤다.
CREATE TABLE campaign_actions_new (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 action TEXT NOT NULL CHECK(action IN('OPEN_SUBMISSION','OPEN_VOTING','PUBLISH_RESULT','ARCHIVE')),
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','EXECUTED','CANCELLED')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 snapshot_digest TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 requested_by TEXT NOT NULL REFERENCES administrators(id),
 requested_at INTEGER NOT NULL,
 executed_by TEXT REFERENCES administrators(id),
 executed_at INTEGER,
 cancelled_by TEXT REFERENCES administrators(id),
 cancelled_at INTEGER,
 cancel_reason TEXT,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 idempotency_key TEXT NOT NULL,
 UNIQUE(campaign_id, action, idempotency_key)
);
INSERT INTO campaign_actions_new SELECT * FROM campaign_actions;
DROP TABLE campaign_actions;
ALTER TABLE campaign_actions_new RENAME TO campaign_actions;
CREATE INDEX campaign_actions_open ON campaign_actions(campaign_id, status, requested_at);
CREATE TRIGGER campaign_action_status_gate BEFORE UPDATE OF status ON campaign_actions
WHEN NOT (NEW.status = OLD.status OR (OLD.status = 'REQUESTED' AND NEW.status IN('EXECUTED','CANCELLED')))
BEGIN SELECT RAISE(ABORT,'ACTION_STATUS_GATE'); END;

-- 내렸던 trigger를 원래 정의로 되돌린다.
CREATE TRIGGER policy_receipt_campaign_gate BEFORE INSERT ON consent_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM submissions s JOIN policy_documents p ON p.campaign_id=s.campaign_id WHERE s.id=NEW.submission_id AND p.id=NEW.policy_id)
 THEN RAISE(ABORT,'POLICY_CAMPAIGN_MISMATCH') END;
END;

-- defer_foreign_keys는 트랜잭션이 끝나면 자동으로 해제된다. 별도 복구 구문을 두지 않는다.
DROP TABLE migration_guard_0003;
