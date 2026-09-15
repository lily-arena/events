import { DomainError } from '@first-seat/domain';
import { canonicalJson, hmacSha256Hex } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 파기 job. PENDING → INTENT_ARCHIVED → DELETED → VERIFIED 의 멱등 상태 기계다.
 * D1 batch 하나에 서명된 요청 기록·실제 삭제·검증·완료 기록을 함께 커밋한다.
 * 온라인 삭제가 Time Travel 복원 이력까지 즉시 지우지는 않는다.
 */

export type DeletionKind = 'CONTACT' | 'SUBMISSION' | 'VOTER' | 'RISK' | 'AUDIT' | 'CONSENT';
export type DeletionState = 'PENDING' | 'INTENT_ARCHIVED' | 'DELETED' | 'VERIFIED' | 'FAILED';

export interface DeletionStatus {
  readonly id: string;
  readonly targetId: string;
  readonly kind: DeletionKind;
  readonly state: DeletionState;
  readonly dueAt: number;
  readonly reason: string;
  readonly attempts: number;
  readonly ledger: readonly { event: string; occurredAt: number; r2Key: string | null; storageBackend: string; restoreResidueUntil: number }[];
}

/** Free 7일 / Paid 30일 중 보수적인 상한. 온라인 삭제는 복원 이력을 즉시 지우지 않는다. */
const RESTORE_RESIDUE_MS = 30 * 24 * 60 * 60 * 1000;

export async function createDeletionJob(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  targetId: string,
  kind: DeletionKind,
  reason: string,
  requestId: string,
): Promise<{ id: string }> {
  requireRole(admin, ['PII_OFFICER']);
  if (reason.trim().length < 3) throw new DomainError('UNPROCESSABLE', '파기 사유가 필요합니다.');
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  const id = newId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO deletion_jobs(id, campaign_id, target_id, kind, state, due_at, reason, attempts, updated_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, 0, ?)`,
      ).bind(id, campaign.id, targetId, kind, now, reason.trim(), now),
      ...auditStatements(
        env,
        {
          actorId: admin.id,
          action: 'DELETION_REQUESTED',
          targetType: 'deletion_job',
          targetId: id,
          outcome: 'SUCCESS',
          requestId,
          reason: reason.trim(),
          metadata: { kind, target: targetId },
        },
        now,
      ),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('UNIQUE constraint failed: deletion_jobs')) {
      throw new DomainError('CONFLICT', '이미 같은 대상의 파기 job이 있습니다.');
    }
    throw error;
  }
  return { id };
}

export async function getDeletionJob(
  env: DataEnv,
  admin: AdminIdentity,
  jobId: string,
): Promise<DeletionStatus> {
  requireRole(admin, ['PII_OFFICER', 'AUDITOR']);
  const row = await env.DB.prepare(
    `SELECT id, target_id, kind, state, due_at, reason, attempts FROM deletion_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<{
      id: string;
      target_id: string;
      kind: DeletionKind;
      state: DeletionState;
      due_at: number;
      reason: string;
      attempts: number;
    }>();
  if (row === null) throw new DomainError('NOT_FOUND', '파기 job을 찾을 수 없습니다.');

  const ledger = await env.DB.prepare(
    `SELECT event, occurred_at, r2_key, storage_backend, restore_residue_until FROM deletion_ledger WHERE job_id = ? ORDER BY occurred_at`,
  )
    .bind(jobId)
    .all<{ event: string; occurred_at: number; r2_key: string | null; storage_backend: string; restore_residue_until: number }>();

  return {
    id: row.id,
    targetId: row.target_id,
    kind: row.kind,
    state: row.state,
    dueAt: row.due_at,
    reason: row.reason,
    attempts: row.attempts,
    ledger: ledger.results.map((l) => ({
      event: l.event,
      occurredAt: l.occurred_at,
      r2Key: l.r2_key,
      storageBackend: l.storage_backend,
      restoreResidueUntil: l.restore_residue_until,
    })),
  };
}

export interface JobRunResult {
  readonly processed: number;
  readonly verified: number;
  readonly failed: number;
}

/**
 * 파기 job 실행. 같은 job을 여러 번 돌려도 데이터를 복구하거나 다시 쓰지 않는다.
 * 이미 없는 대상은 성공으로 간주한다.
 */
interface PendingJob {
  id: string;
  campaign_id: string;
  target_id: string;
  kind: DeletionKind;
}

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;

/** Existing signed intents from an interrupted/legacy retry must match the immutable job. */
async function ledgerStatement(
  env: DataEnv, job: PendingJob, event: 'INTENT' | 'COMPLETE', now: number,
): Promise<D1PreparedStatement[]> {
  const existing = await env.DB.prepare(
    `SELECT payload_json, digest, occurred_at, restore_residue_until, retention_until
       FROM deletion_ledger WHERE job_id=? AND event=? AND storage_backend='D1'`,
  ).bind(job.id, event).first<{
    payload_json: string; digest: string; occurred_at: number;
    restore_residue_until: number; retention_until: number;
  }>();
  const payload = {
    schemaVersion: 1, event, jobId: job.id, campaignId: job.campaign_id,
    targetId: job.target_id, kind: job.kind,
    occurredAt: existing?.occurred_at ?? now,
    restoreResidueUntil: existing?.restore_residue_until ?? now + RESTORE_RESIDUE_MS,
    retentionUntil: existing?.retention_until ?? now + RETENTION_MS,
  };
  const serialized = canonicalJson(payload);
  const digest = await hmacSha256Hex(env.AUDIT_SIGNING_SECRET, serialized);
  if (existing !== null) {
    if (existing.payload_json !== serialized || existing.digest !== digest) {
      throw new Error('DELETION_LEDGER_INTEGRITY');
    }
    // A completed job must not be silently reused after an operator restores its target.
    if (event === 'COMPLETE') throw new Error('DELETION_ALREADY_COMPLETED_REQUIRES_RECOVERY');
    return [];
  }
  return [env.DB.prepare(
    `INSERT INTO deletion_ledger(id,job_id,event,occurred_at,restore_residue_until,
       r2_key,archived_at,storage_backend,payload_json,digest,retention_until)
     VALUES (?,?,?,?,?,NULL,NULL,'D1',?,?,?)`,
  ).bind(`d1:${job.id}:${event}`, job.id, event, now, payload.restoreResidueUntil,
    serialized, digest, payload.retentionUntil)];
}

const REMAINING_SQL: Record<DeletionKind, string> = {
  CONTACT: `SELECT COUNT(*) AS n FROM pii_contacts WHERE submission_id = ?`,
  SUBMISSION: `SELECT COUNT(*) AS n FROM submissions WHERE id = ?`,
  VOTER: `SELECT COUNT(*) AS n FROM anonymous_sessions WHERE id = ?`,
  RISK: `SELECT COUNT(*) AS n FROM vote_risk_signals WHERE vote_id = ?`,
  CONSENT: `SELECT COUNT(*) AS n FROM consent_receipts WHERE submission_id = ?`,
  AUDIT: `SELECT COUNT(*) AS n FROM audit_events WHERE id = ?`,
};

export async function runDeletionJobs(env: DataEnv, limit = 20): Promise<JobRunResult> {
  const now = Date.now();
  const jobs = await env.DB.prepare(
    `SELECT id,campaign_id,target_id,kind FROM deletion_jobs
     WHERE state IN ('PENDING','INTENT_ARCHIVED','DELETED','FAILED') AND due_at<=?
       AND (lease_until IS NULL OR lease_until<=?) ORDER BY updated_at,id LIMIT ?`,
  ).bind(now, now, limit).all<PendingJob>();
  let processed = 0;
  let verified = 0;
  let failed = 0;
  // Count SQL statements conservatively, including failed batches and their retry-state update.
  // Reserve the rest of the Free-plan invocation budget for audit, expiry, and Admin RPC checks.
  let remainingQueryBudget = 26;
  for (const job of jobs.results) {
    const worstCaseQueries = job.kind === 'SUBMISSION' ? 17 : job.kind === 'VOTER' ? 15 : 13;
    if (remainingQueryBudget < worstCaseQueries) break;
    remainingQueryBudget -= worstCaseQueries;
    const lease = newId();
    const claimedAt = Date.now();
    const claimed = await env.DB.prepare(
      `UPDATE deletion_jobs SET lease_token=?,lease_until=? WHERE id=?
       AND state IN ('PENDING','INTENT_ARCHIVED','DELETED','FAILED')
       AND (lease_until IS NULL OR lease_until<=?)`,
    ).bind(lease, claimedAt + LEASE_MS, job.id, claimedAt).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    processed += 1;
    try {
      const intent = await ledgerStatement(env, job, 'INTENT', claimedAt);
      const complete = await ledgerStatement(env, job, 'COMPLETE', claimedAt);
      const leaseGuard = newId();
      const deletionGuard = newId();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO operation_guards(id,ok) VALUES (?,CASE WHEN EXISTS(
             SELECT 1 FROM deletion_jobs WHERE id=? AND lease_token=? AND lease_until>?
           ) THEN 1 ELSE 0 END)`,
        ).bind(leaseGuard, job.id, lease, Date.now()),
        ...intent,
        ...deleteStatements(env, job.kind, job.target_id, claimedAt),
        // The check and completion are in the deletion transaction, never a separate read.
        env.DB.prepare(
          `INSERT INTO operation_guards(id,ok) VALUES (?,CASE WHEN (${REMAINING_SQL[job.kind]})=0 THEN 1 ELSE 0 END)`,
        ).bind(deletionGuard, job.target_id),
        ...complete,
        env.DB.prepare(
          `UPDATE deletion_jobs SET state='VERIFIED',updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`,
        ).bind(claimedAt, job.id, lease),
        ...auditStatements(env, {
          actorId: null, action: 'DELETION_VERIFIED', targetType: 'deletion_job',
          targetId: job.id, outcome: 'SUCCESS', requestId: `cron-${job.id}`,
        }, claimedAt),
        env.DB.prepare(`DELETE FROM operation_guards WHERE id IN (?,?)`).bind(leaseGuard, deletionGuard),
      ]);
      verified += 1;
    } catch {
      failed += 1;
      await env.DB.prepare(
        `UPDATE deletion_jobs SET state='FAILED',attempts=attempts+1,updated_at=?,lease_token=NULL,lease_until=NULL
         WHERE id=? AND lease_token=?`,
      ).bind(Date.now(), job.id, lease).run();
    }
  }
  return { processed, verified, failed };
}

function deleteStatements(
  env: DataEnv,
  kind: DeletionKind,
  targetId: string,
  now: number,
): D1PreparedStatement[] {
  switch (kind) {
    case 'CONTACT':
      // 연락처만 지우고 접수·문구 기록은 남긴다.
      return [
        env.DB.prepare(`DELETE FROM pii_contacts WHERE submission_id = ?`).bind(targetId),
      ];
    case 'SUBMISSION':
      // 공개 권리가 확인된 후보 snapshot은 유지하고 source 연결만 끊는다.
      return [
        env.DB.prepare(`UPDATE candidates SET source_submission_id = NULL WHERE source_submission_id = ?`).bind(
          targetId,
        ),
        env.DB.prepare(`DELETE FROM pii_contacts WHERE submission_id = ?`).bind(targetId),
        env.DB.prepare(`DELETE FROM consent_receipts WHERE submission_id = ?`).bind(targetId),
        /*
         * 원문 열람 이력은 이 응모를 가리킨다. 연쇄 삭제가 걸려 있지 않아
         * 먼저 지우지 않으면 응모 삭제가 외래키 제약으로 실패한다.
         * 열람 사실 자체는 audit_events에 남으므로 기록이 사라지지는 않는다.
         */
        env.DB.prepare(`DELETE FROM reveal_grants WHERE submission_id = ?`).bind(targetId),
        env.DB.prepare(`DELETE FROM submissions WHERE id = ?`).bind(targetId),
      ];
    case 'VOTER':
      // 표 수·후보·수락 시각은 유지하고 session 연결만 끊는다.
      return [
        env.DB.prepare(`UPDATE votes SET voter_session_id = NULL WHERE voter_session_id = ?`).bind(targetId),
        env.DB.prepare(`DELETE FROM session_policy_receipts WHERE session_id = ?`).bind(targetId),
        env.DB.prepare(`DELETE FROM anonymous_sessions WHERE id = ?`).bind(targetId),
      ];
    case 'RISK':
      return [env.DB.prepare(`DELETE FROM vote_risk_signals WHERE vote_id = ?`).bind(targetId)];
    case 'CONSENT':
      return [env.DB.prepare(`DELETE FROM consent_receipts WHERE submission_id = ?`).bind(targetId)];
    case 'AUDIT':
      // 보유기간이 지나고 D1 서명 확정이 끝난 기록만 trigger가 삭제를 허용한다.
      return [env.DB.prepare(`DELETE FROM audit_events WHERE id = ? AND retention_until <= ?`).bind(targetId, now)];
  }
}

/**
 * 보유기간이 지난 연락처의 파기 job을 자동 생성한다.
 * Time Travel 복원 후에도 만료 config로 대상을 다시 찾을 수 있게 한다.
 */
export async function enqueueExpiredContacts(env: DataEnv, limit = 20): Promise<number> {
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT p.submission_id, s.campaign_id FROM pii_contacts p
       JOIN submissions s ON s.id = p.submission_id
      WHERE p.retention_until <= ?
        AND NOT EXISTS (SELECT 1 FROM deletion_jobs j WHERE j.target_id = p.submission_id AND j.kind = 'CONTACT')
      LIMIT ?`,
  )
    .bind(now, Math.min(20, Math.max(1, Math.trunc(limit))))
    .all<{ submission_id: string; campaign_id: string }>();

  if (rows.results.length === 0) return 0;
  // One statement, at most 20 rows × 5 parameters; preserves the unique request boundary.
  const result = await env.DB.prepare(
    `INSERT INTO deletion_jobs(id,campaign_id,target_id,kind,state,due_at,reason,attempts,updated_at)
     VALUES ${rows.results.map(() => "(?,?,?,'CONTACT','PENDING',?,'보유기간 만료',0,?)").join(',')}
     ON CONFLICT(campaign_id,target_id,kind) DO NOTHING`,
  ).bind(...rows.results.flatMap(row => [newId(), row.campaign_id, row.submission_id, now, now])).run();
  return result.meta.changes ?? 0;
}
