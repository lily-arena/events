-- 공개 전환 업무 명령. 요청 → (다른 책임자) 실행을 기록한다.
-- 기존 state 기계와 transition_events는 그대로 두고 이 표는 사람의 요청·승인만 담는다.
-- 새 publicPhase 컬럼을 만들지 않는다.

CREATE TABLE campaign_actions (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 action TEXT NOT NULL CHECK(action IN('OPEN_SUBMISSION','OPEN_VOTING','PUBLISH_RESULT','ARCHIVE')),
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','EXECUTED','CANCELLED')),
 -- 요청 시점의 관련 자료(콘텐츠 버전·후보·결과·일정)를 묶은 값. 실행 직전 다시 대조한다.
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 snapshot_digest TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 reason TEXT NOT NULL,
 requested_by TEXT NOT NULL REFERENCES administrators(id),
 requested_at INTEGER NOT NULL,
 executed_by TEXT REFERENCES administrators(id),
 executed_at INTEGER,
 cancelled_by TEXT REFERENCES administrators(id),
 cancelled_at INTEGER,
 cancel_reason TEXT,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 -- 관리자·캠페인·명령 범위로 묶인 재시도 key
 idempotency_key TEXT NOT NULL,
 UNIQUE(campaign_id, action, idempotency_key),
 CHECK(executed_by IS NULL OR executed_by <> requested_by)
);

CREATE INDEX campaign_actions_open ON campaign_actions(campaign_id, status, requested_at);

-- 요청은 기록이므로 실행·취소 외의 값은 바꾸지 않는다.
CREATE TRIGGER campaign_action_immutable BEFORE UPDATE ON campaign_actions
WHEN NEW.action <> OLD.action OR NEW.campaign_id <> OLD.campaign_id
  OR NEW.snapshot_digest <> OLD.snapshot_digest OR NEW.requested_by <> OLD.requested_by
  OR NEW.requested_at <> OLD.requested_at OR NEW.expected_revision <> OLD.expected_revision
BEGIN SELECT RAISE(ABORT,'ACTION_IMMUTABLE'); END;

-- 이미 끝난 요청은 다시 실행하거나 취소하지 않는다.
CREATE TRIGGER campaign_action_status_gate BEFORE UPDATE OF status ON campaign_actions
WHEN NOT (NEW.status = OLD.status OR (OLD.status = 'REQUESTED' AND NEW.status IN('EXECUTED','CANCELLED')))
BEGIN SELECT RAISE(ABORT,'ACTION_STATUS_GATE'); END;

-- 예정 마감처럼 사람이 아닌 주체가 수행하는 전환의 실행 주체.
-- 로그인할 수 없는 계정이며 승인자(approval)로는 절대 쓰지 않는다.
INSERT INTO administrators(id, access_subject, email, active, created_at)
VALUES ('00000000-0000-4000-8000-0000000000ff', 'system:scheduler', 'scheduler@first-seat.internal', 0,
        CAST(strftime('%s','now') AS INTEGER) * 1000);
