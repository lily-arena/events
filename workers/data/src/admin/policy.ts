import { DomainError } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { approvalStatement, auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/** 동의문·유의사항 정책 버전. 승인된 정책은 불변이며 새 버전으로만 바꾼다. */

const POLICY_KINDS = [
  'PRIVACY',
  'WORK_LICENSE',
  'OVERSEAS',
  'VOTE_PRIVACY',
  'NOTICE_SUBMISSION',
  'NOTICE_VOTING',
  'ELIGIBILITY',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export interface PolicyView {
  readonly id: string;
  readonly kind: PolicyKind;
  readonly version: number;
  readonly body: string;
  readonly approved: boolean;
  readonly makerId: string | null;
}

export async function createPolicy(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  kind: PolicyKind,
  body: string,
  requestId: string,
): Promise<PolicyView> {
  requireRole(admin, ['PII_OFFICER', 'OWNER']);
  if (!POLICY_KINDS.includes(kind)) throw new DomainError('BAD_REQUEST', '알 수 없는 정책 종류입니다.');
  if (body.trim().length < 20) throw new DomainError('UNPROCESSABLE', '정책 본문이 너무 짧습니다.');

  const campaign = await loadCampaign(env, campaignSlug);
  const max = await env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) AS version FROM policy_documents WHERE campaign_id = ? AND kind = ?`,
  )
    .bind(campaign.id, kind)
    .first<{ version: number }>();
  const version = (max?.version ?? 0) + 1;
  const id = newId();
  const now = Date.now();
  const digest = await digestOf(body);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO policy_documents(id, campaign_id, kind, version, body, digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, campaign.id, kind, version, body, digest, now),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'POLICY_DRAFTED',
        targetType: 'policy_document',
        targetId: id,
        outcome: 'SUCCESS',
        requestId,
        metadata: { kind, version },
      },
      now,
    ),
  ]);
  return { id, kind, version, body, approved: false, makerId: admin.id };
}

/**
 * 정책 승인. 실제 적용은 콘텐츠 게시 batch에서 이뤄진다.
 * 승인만으로 기존 동의 내용을 덮어쓰지 않는다.
 */
export async function approvePolicy(
  env: DataEnv,
  admin: AdminIdentity,
  policyId: string,
  requestId: string,
): Promise<{ approvalId: string }> {
  requireRole(admin, ['OWNER']);
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, kind, body, digest, approval_id FROM policy_documents WHERE id = ?`,
  )
    .bind(policyId)
    .first<{ id: string; campaign_id: string; kind: string; body: string; digest: string; approval_id: string | null }>();
  if (row === null) throw new DomainError('NOT_FOUND', '정책을 찾을 수 없습니다.');
  if (row.approval_id !== null) throw new DomainError('CONFLICT', '이미 승인된 정책입니다.');

  const recomputed = await digestOf(row.body);
  if (recomputed !== row.digest) throw new DomainError('CONFLICT', '정책 본문이 변경되었습니다.');

  const maker = await env.DB.prepare(
    `SELECT actor_id FROM audit_events WHERE target_id = ? AND action = 'POLICY_DRAFTED' ORDER BY occurred_at DESC LIMIT 1`,
  )
    .bind(policyId)
    .first<{ actor_id: string | null }>();
  if (maker?.actor_id == null) throw new DomainError('CONFLICT', '정책 작성자를 확인할 수 없습니다.');

  const now = Date.now();
  const approvalId = newId();
  await env.DB.batch([
    approvalStatement(
      env,
      approvalId,
      { action: 'POLICY_APPROVE', payloadDigest: row.digest, makerId: maker.actor_id, checkerId: admin.id },
      now,
    ),
    env.DB.prepare(`UPDATE policy_documents SET approval_id = ?, effective_at = ? WHERE id = ?`).bind(
      approvalId,
      now,
      policyId,
    ),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'POLICY_APPROVED',
        targetType: 'policy_document',
        targetId: policyId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { kind: row.kind },
      },
      now,
    ),
  ]);
  return { approvalId };
}

/** 승인된 정책을 현재 적용 정책으로 연결한다. */
export async function activatePolicy(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  policyId: string,
  required: boolean,
  requestId: string,
): Promise<void> {
  requireRole(admin, ['OWNER']);
  const campaign = await loadCampaign(env, campaignSlug);
  const row = await env.DB.prepare(
    `SELECT kind, approval_id FROM policy_documents WHERE id = ? AND campaign_id = ?`,
  )
    .bind(policyId, campaign.id)
    .first<{ kind: string; approval_id: string | null }>();
  if (row === null) throw new DomainError('NOT_FOUND', '정책을 찾을 수 없습니다.');
  if (row.approval_id === null) throw new DomainError('CONFLICT', '승인된 정책만 적용할 수 있습니다.');

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaign_policies(campaign_id, kind, policy_id, required) VALUES (?, ?, ?, ?)
       ON CONFLICT(campaign_id, kind) DO UPDATE SET policy_id = excluded.policy_id, required = excluded.required`,
    ).bind(campaign.id, row.kind, policyId, required ? 1 : 0),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'POLICY_ACTIVATED',
        targetType: 'policy_document',
        targetId: policyId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { kind: row.kind, required },
      },
      now,
    ),
  ]);
}

export async function listPolicies(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<readonly PolicyView[]> {
  requireRole(admin, ['PII_OFFICER', 'OWNER', 'OPERATOR']);
  const campaign = await loadCampaign(env, campaignSlug);
  const rows = await env.DB.prepare(
    `SELECT id, kind, version, body, approval_id FROM policy_documents WHERE campaign_id = ? ORDER BY kind, version DESC`,
  )
    .bind(campaign.id)
    .all<{ id: string; kind: PolicyKind; version: number; body: string; approval_id: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    version: row.version,
    body: row.body,
    approved: row.approval_id !== null,
    makerId: null,
  }));
}
