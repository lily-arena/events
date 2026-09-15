import { canonicalJson, hmacSha256Hex } from '@first-seat/security';
import type { DataEnv } from './env.js';
import { enqueueExpiredContacts, runDeletionJobs } from './admin/deletion.js';
import { auditStatements } from './admin/common.js';
import { newId } from './ids.js';

/**
 * 예정 마감 정리.
 * 마감 시각은 서버 시각으로 이미 효력이 있고(쓰기 API와 public 화면이 모두 마감으로 처리한다),
 * 여기서는 뒤늦게 DB state만 맞춘다. 사람이 승인한 전환이 아니므로 approval은 남기지 않고
 * 로그인할 수 없는 시스템 계정을 실행 주체로 기록한다.
 */
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-0000000000ff';

export async function closeDueCampaigns(env: DataEnv): Promise<number> {
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT id, state, revision, submission_end, voting_end FROM campaigns
      WHERE (state = 'SUBMISSION_OPEN' AND submission_end IS NOT NULL AND submission_end <= ?)
         OR (state = 'VOTING_OPEN' AND voting_end IS NOT NULL AND voting_end <= ?) LIMIT 1`,
  )
    .bind(now, now)
    .all<{ id: string; state: string; revision: number; submission_end: number | null; voting_end: number | null }>();

  let closed = 0;
  for (const row of rows.results) {
    const toState = row.state === 'SUBMISSION_OPEN' ? 'SUBMISSION_CLOSED' : 'VOTING_CLOSED';
    try {
      // 이미 다른 경로로 닫혔으면 trigger가 막는다. 멱등하게 동작한다.
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO transition_events(id, campaign_id, from_state, to_state, expected_revision, actor_id, approval_id, reason, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, '예정된 마감 시각 도달', ?)`,
        ).bind(newId(), row.id, row.state, toState, row.revision, SYSTEM_ACTOR_ID, now),
        ...auditStatements(
          env,
          {
            actorId: SYSTEM_ACTOR_ID,
            action: 'CAMPAIGN_CLOSED_ON_SCHEDULE',
            targetType: 'campaign',
            targetId: row.id,
            outcome: 'SUCCESS',
            requestId: `schedule-${row.id}-${toState}`,
            metadata: { toState },
          },
          now,
        ),
      ]);
      closed += 1;
    } catch {
      // 경쟁으로 이미 전환되었으면 다음 주기에 다시 확인한다.
    }
  }
  return closed;
}

/**
 * Cron 작업. D1에 저장된 감사 이벤트의 HMAC을 확정하고 만료 데이터를 파기한다.
 * 이벤트와 서명은 보유기간 동안 수정할 수 없다. DB 소유자의 전체 복원/변조를 막는 외부 원장은 아니다.
 */

export interface OutboxResult {
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
}

// 20 signatures use 61 bound parameters, below D1's 100-parameter limit.
const OUTBOX_BATCH = 20;

export async function deliverAuditOutbox(env: DataEnv): Promise<OutboxResult> {
  const rows = await env.DB.prepare(
    `SELECT o.event_id, o.attempts,
            e.actor_id, e.action, e.target_type, e.target_id, e.occurred_at, e.outcome, e.reason,
            e.request_id, e.metadata_json, e.retention_until
       FROM audit_outbox o JOIN audit_events e ON e.id = o.event_id
      WHERE o.delivered_at IS NULL
      ORDER BY e.occurred_at LIMIT ?`,
  )
    .bind(OUTBOX_BATCH)
    .all<{
      event_id: string;
      attempts: number;
      actor_id: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      occurred_at: number;
      outcome: string;
      reason: string | null;
      request_id: string;
      metadata_json: string;
      retention_until: number;
    }>();

  let delivered = 0;
  let failed = 0;

  const signatures: { id: string; digest: string }[] = [];
  for (const row of rows.results) {
    const payload = {
      id: row.event_id,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      occurredAt: row.occurred_at,
      outcome: row.outcome,
      reason: row.reason,
      requestId: row.request_id,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      retentionUntil: row.retention_until,
    };
    // 원본 이벤트는 생성 시 업무 변경과 같은 D1 batch에 저장된다. 이 단계는 외부 전송이 아닌 서명 확정이다.
    const digest = await hmacSha256Hex(env.AUDIT_SIGNING_SECRET, canonicalJson(payload));
    signatures.push({ id: row.event_id, digest });
  }
  if (signatures.length > 0) {
    const ids = signatures.map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');
    try {
      const result = await env.DB.prepare(
        `UPDATE audit_outbox SET delivered_at=?,digest=CASE event_id ${signatures.map(() => 'WHEN ? THEN ?').join(' ')} END,
          storage_backend='D1' WHERE delivered_at IS NULL AND event_id IN (${placeholders})`,
      ).bind(Date.now(), ...signatures.flatMap(s => [s.id, s.digest]), ...ids).run();
      delivered = result.meta.changes ?? 0;
    } catch {
      const result = await env.DB.prepare(
        `UPDATE audit_outbox SET attempts=attempts+1 WHERE delivered_at IS NULL AND event_id IN (${placeholders})`,
      ).bind(...ids).run();
      failed = result.meta.changes ?? 0;
    }
  }

  const pendingRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_outbox WHERE delivered_at IS NULL`,
  ).first<{ n: number }>();

  return { delivered, failed, pending: pendingRow?.n ?? 0 };
}

/** 만료된 멱등 기록·rate bucket·위험 신호를 정리한다. */
export async function cleanupExpired(env: DataEnv): Promise<number> {
  const now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(`DELETE FROM idempotency_records WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM rate_buckets WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM vote_risk_signals WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM anonymous_sessions WHERE expires_at <= ?`).bind(now),
    // guard row가 남으면 다음 batch를 막으므로 오래된 것은 정리한다.
    env.DB.prepare(`DELETE FROM operation_guards`),
    env.DB.prepare(`DELETE FROM deletion_ledger WHERE id IN (SELECT l.id FROM deletion_ledger l JOIN deletion_jobs j ON j.id=l.job_id WHERE l.retention_until<=? AND j.state='VERIFIED' LIMIT 50)`).bind(now),
    // Retained audit records expire in bounded batches; the trigger removes the matching seal.
    env.DB.prepare(`DELETE FROM audit_events WHERE id IN (SELECT e.id FROM audit_events e JOIN audit_outbox o ON o.event_id=e.id WHERE e.retention_until<=? AND o.delivered_at IS NOT NULL AND o.digest IS NOT NULL LIMIT 50)`).bind(now),
  ]);
  return result.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
}

export interface CronSummary {
  readonly outbox: OutboxResult;
  readonly cleaned: number;
  readonly enqueued: number;
  readonly closed: number;
  readonly deletion: { processed: number; verified: number; failed: number };
}

export async function runScheduled(env: DataEnv): Promise<CronSummary> {
  const closed = await closeDueCampaigns(env);
  const outbox = await deliverAuditOutbox(env);
  const cleaned = await cleanupExpired(env);
  const enqueued = await enqueueExpiredContacts(env);
  const deletion = await runDeletionJobs(env);
  return { outbox, cleaned, enqueued, closed, deletion };
}
