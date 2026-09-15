import { DomainError } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import {
  auditStatements,
  clampLimit,
  decodeCursor,
  encodeCursor,
  requireRole,
  type AdminIdentity,
} from './common.js';

/**
 * 심사. 목록과 일반 상세에서는 개인정보를 아예 조회하지 않는다.
 * 연락처 검색도 제공하지 않는다.
 */

export interface ReviewRow {
  readonly id: string;
  readonly message: string;
  readonly acceptedAt: number;
  readonly status: string;
  readonly reviewerNote: string;
  readonly rowVersion: number;
}

export interface ReviewList {
  readonly rows: readonly ReviewRow[];
  readonly nextCursor: string | null;
  readonly counts: { total: number; pending: number; approved: number; rejected: number; candidate: number };
}

export interface ListSubmissionsInput {
  readonly campaignSlug: string;
  readonly status: string | null;
  readonly query: string | null;
  readonly cursor: string | null;
  readonly limit: number | null;
}

export async function listSubmissions(
  env: DataEnv,
  admin: AdminIdentity,
  input: ListSubmissionsInput,
): Promise<ReviewList> {
  requireRole(admin);
  const campaign = await loadCampaign(env, input.campaignSlug);
  const limit = clampLimit(input.limit);

  const where: string[] = ['campaign_id = ?'];
  const binds: (string | number)[] = [campaign.id];

  if (input.status !== null && input.status.length > 0) {
    if (!['PENDING', 'APPROVED', 'REJECTED', 'CANDIDATE', 'WITHDRAWN'].includes(input.status)) {
      throw new DomainError('BAD_REQUEST', '알 수 없는 상태입니다.');
    }
    where.push('status = ?');
    binds.push(input.status);
  }
  if (input.query !== null && input.query.trim().length > 0) {
    const needle = input.query.trim().slice(0, 60);
    // 문구와 ID로만 검색한다. 연락처 검색은 제공하지 않는다.
    where.push('(message LIKE ? ESCAPE \'\\\' OR id = ?)');
    binds.push(`%${needle.replace(/[%_\\]/gu, (c) => `\\${c}`)}%`, needle);
  }

  const cursor = decodeCursor(input.cursor);
  if (cursor !== null) {
    // 안정 정렬 key: (accepted_at, id)
    where.push('(accepted_at < ? OR (accepted_at = ? AND id < ?))');
    binds.push(Number(cursor[0]), Number(cursor[0]), String(cursor[1]));
  }

  const rows = await env.DB.prepare(
    `SELECT id, message, accepted_at, status, reviewer_note, row_version
       FROM submissions
      WHERE ${where.join(' AND ')}
      ORDER BY accepted_at DESC, id DESC
      LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      message: string;
      accepted_at: number;
      status: string;
      reviewer_note: string;
      row_version: number;
    }>();

  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.results.length > limit && last !== undefined ? encodeCursor([last.accepted_at, last.id]) : null;

  const counts = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN status = 'CANDIDATE' THEN 1 ELSE 0 END) AS candidate
     FROM submissions WHERE campaign_id = ?`,
  )
    .bind(campaign.id)
    .first<{
      total: number;
      pending: number | null;
      approved: number | null;
      rejected: number | null;
      candidate: number | null;
    }>();

  return {
    rows: page.map((row) => ({
      id: row.id,
      message: row.message,
      acceptedAt: row.accepted_at,
      status: row.status,
      reviewerNote: row.reviewer_note,
      rowVersion: row.row_version,
    })),
    nextCursor,
    counts: {
      total: counts?.total ?? 0,
      pending: counts?.pending ?? 0,
      approved: counts?.approved ?? 0,
      rejected: counts?.rejected ?? 0,
      candidate: counts?.candidate ?? 0,
    },
  };
}

export interface SubmissionDetail extends ReviewRow {
  readonly configRevision: number;
  readonly contentVersionId: string | null;
  readonly graphemeCount: number;
  readonly consents: readonly { kind: string; version: number; acceptedAt: number }[];
  readonly piiPresent: boolean;
  readonly history: readonly { action: string; occurredAt: number; outcome: string }[];
}

export async function getSubmission(
  env: DataEnv,
  admin: AdminIdentity,
  submissionId: string,
): Promise<SubmissionDetail> {
  requireRole(admin);
  const row = await env.DB.prepare(
    `SELECT id, message, accepted_at, status, reviewer_note, row_version, config_revision, content_version_id, grapheme_count
       FROM submissions WHERE id = ?`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      message: string;
      accepted_at: number;
      status: string;
      reviewer_note: string;
      row_version: number;
      config_revision: number;
      content_version_id: string | null;
      grapheme_count: number;
    }>();
  if (row === null) throw new DomainError('NOT_FOUND', '응모작을 찾을 수 없습니다.');

  const consents = await env.DB.prepare(
    `SELECT p.kind, p.version, r.accepted_at
       FROM consent_receipts r JOIN policy_documents p ON p.id = r.policy_id
      WHERE r.submission_id = ? ORDER BY p.kind`,
  )
    .bind(submissionId)
    .all<{ kind: string; version: number; accepted_at: number }>();

  const pii = await env.DB.prepare(`SELECT 1 AS found FROM pii_contacts WHERE submission_id = ?`)
    .bind(submissionId)
    .first<{ found: number }>();

  const history = await env.DB.prepare(
    `SELECT action, occurred_at, outcome FROM audit_events
      WHERE target_type = 'submission' AND target_id = ?
      ORDER BY occurred_at DESC LIMIT 20`,
  )
    .bind(submissionId)
    .all<{ action: string; occurred_at: number; outcome: string }>();

  return {
    id: row.id,
    message: row.message,
    acceptedAt: row.accepted_at,
    status: row.status,
    reviewerNote: row.reviewer_note,
    rowVersion: row.row_version,
    configRevision: row.config_revision,
    contentVersionId: row.content_version_id,
    graphemeCount: row.grapheme_count,
    consents: consents.results.map((c) => ({ kind: c.kind, version: c.version, acceptedAt: c.accepted_at })),
    piiPresent: pii !== null,
    history: history.results.map((h) => ({ action: h.action, occurredAt: h.occurred_at, outcome: h.outcome })),
  };
}

export interface ReviewUpdateInput {
  readonly submissionId: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANDIDATE';
  readonly reviewerNote: string;
  readonly expectedRowVersion: number;
  readonly requestId: string;
}

export async function updateSubmission(
  env: DataEnv,
  admin: AdminIdentity,
  input: ReviewUpdateInput,
): Promise<{ rowVersion: number }> {
  requireRole(admin);
  if (input.reviewerNote.length > 2000) {
    throw new DomainError('UNPROCESSABLE', '검토 메모는 2000자 이내여야 합니다.');
  }
  if (!['PENDING', 'APPROVED', 'REJECTED', 'CANDIDATE'].includes(input.status)) {
    throw new DomainError('BAD_REQUEST', '알 수 없는 상태입니다.');
  }

  // 투표가 시작된 뒤에는 실제 투표 대상과 연결된 후보를 바꾸지 않는다.
  const locked = await env.DB.prepare(
    `SELECT 1 AS locked FROM candidates c
       JOIN candidate_sets s ON s.id = c.set_id
       JOIN campaigns cp ON cp.id = s.campaign_id
      WHERE c.source_submission_id = ? AND s.status = 'FROZEN'
        AND cp.state IN ('VOTING_OPEN','VOTING_CLOSED','RESULT_READY','RESULT_PUBLISHED','ARCHIVED')`,
  )
    .bind(input.submissionId)
    .first<{ locked: number }>();
  if (locked !== null) {
    throw new DomainError('CONFLICT', '투표가 시작된 후보는 변경할 수 없습니다. 접수된 표와의 연결을 유지해야 합니다.');
  }
  // 투표 진행 중에는 새 후보를 추가할 수 없다.
  if (input.status === 'CANDIDATE') {
    const votingOpen = await env.DB.prepare(
      `SELECT 1 AS open FROM campaigns WHERE state IN ('VOTING_OPEN','VOTING_CLOSED','RESULT_READY','RESULT_PUBLISHED','ARCHIVED')`,
    ).first<{ open: number }>();
    if (votingOpen !== null) {
      throw new DomainError('CONFLICT', '투표가 시작된 뒤에는 후보를 추가할 수 없습니다.');
    }
  }

  const now = Date.now();
  const guardId = crypto.randomUUID();

  try {
    await env.DB.batch([
      // 낙관적 동시성: 기대 row_version이 아니면 batch 전체가 실패한다.
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM submissions WHERE id = ? AND row_version = ?
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, input.submissionId, input.expectedRowVersion),
      env.DB.prepare(
        `UPDATE submissions
            SET status = ?, reviewer_note = ?, reviewer_id = ?, row_version = row_version + 1,
                candidate_order = CASE
                  WHEN ? = 'CANDIDATE' THEN COALESCE(candidate_order,
                    (SELECT COALESCE(MAX(candidate_order), -1) + 1 FROM submissions WHERE campaign_id =
                      (SELECT campaign_id FROM submissions WHERE id = ?) AND status = 'CANDIDATE'))
                  ELSE NULL END
          WHERE id = ? AND row_version = ?`,
      ).bind(
        input.status,
        input.reviewerNote,
        admin.id,
        input.status,
        input.submissionId,
        input.submissionId,
        input.expectedRowVersion,
      ),
      ...auditStatements(
        env,
        {
          actorId: admin.id,
          action: 'SUBMISSION_REVIEWED',
          targetType: 'submission',
          targetId: input.submissionId,
          outcome: 'SUCCESS',
          requestId: input.requestId,
          metadata: { status: input.status, noteLength: input.reviewerNote.length },
        },
        now,
      ),
      env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '다른 관리자가 수정했습니다.');
    }
    throw error;
  }
  return { rowVersion: input.expectedRowVersion + 1 };
}
