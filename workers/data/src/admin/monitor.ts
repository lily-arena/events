import { DomainError } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { approvalStatement, auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 투표 모니터. 접속 IP 원문·정밀 fingerprint는 화면에 내보내지 않는다.
 * received = included + pending + excluded 를 항상 유지한다.
 */

export interface MonitorTally {
  readonly candidateId: string;
  readonly number: number;
  readonly message: string;
  readonly included: number;
  readonly pending: number;
  readonly excluded: number;
}

export interface MonitorView {
  readonly state: string;
  readonly epoch: number;
  readonly refreshedAt: number;
  readonly received: number;
  readonly included: number;
  readonly pending: number;
  readonly excluded: number;
  readonly tally: readonly MonitorTally[];
  readonly usage: { submissions: number; votes: number; auditPending: number };
}

/** 최신 verdict만 유효하다. decision이 없으면 initial_review_state를 쓴다. */
const EFFECTIVE_STATE_SQL = `
  COALESCE(
    (SELECT d.verdict FROM vote_decisions d
      WHERE d.vote_id = v.id
      ORDER BY d.version DESC LIMIT 1),
    v.initial_review_state
  )`;

export async function getMonitor(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<MonitorView> {
  requireRole(admin, ['OPERATOR', 'OWNER']);
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS received,
       SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'INCLUDED' THEN 1 ELSE 0 END) AS included,
       SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'PENDING' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'EXCLUDED' THEN 1 ELSE 0 END) AS excluded
     FROM votes v WHERE v.campaign_id = ? AND v.epoch = ?`,
  )
    .bind(campaign.id, campaign.voting_epoch)
    .first<{ received: number; included: number | null; pending: number | null; excluded: number | null }>();

  const tally = await env.DB.prepare(
    `SELECT c.id, c.public_number, c.public_message,
            SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'INCLUDED' THEN 1 ELSE 0 END) AS included,
            SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN ${EFFECTIVE_STATE_SQL} = 'EXCLUDED' THEN 1 ELSE 0 END) AS excluded
       FROM candidates c
       LEFT JOIN votes v ON v.candidate_id = c.id
       JOIN candidate_sets s ON s.id = c.set_id
      WHERE s.campaign_id = ? AND s.epoch = ?
      GROUP BY c.id ORDER BY c.display_order`,
  )
    .bind(campaign.id, campaign.voting_epoch)
    .all<{
      id: string;
      public_number: number;
      public_message: string;
      included: number | null;
      pending: number | null;
      excluded: number | null;
    }>();

  const usage = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM submissions WHERE campaign_id = ?) AS submissions,
       (SELECT COUNT(*) FROM votes WHERE campaign_id = ?) AS votes,
       (SELECT COUNT(*) FROM audit_outbox WHERE delivered_at IS NULL) AS audit_pending`,
  )
    .bind(campaign.id, campaign.id)
    .first<{ submissions: number; votes: number; audit_pending: number }>();

  return {
    state: campaign.state,
    epoch: campaign.voting_epoch,
    refreshedAt: now,
    received: totals?.received ?? 0,
    included: totals?.included ?? 0,
    pending: totals?.pending ?? 0,
    excluded: totals?.excluded ?? 0,
    tally: tally.results.map((row) => ({
      candidateId: row.id,
      number: row.public_number,
      message: row.public_message,
      included: row.included ?? 0,
      pending: row.pending ?? 0,
      excluded: row.excluded ?? 0,
    })),
    usage: {
      submissions: usage?.submissions ?? 0,
      votes: usage?.votes ?? 0,
      auditPending: usage?.audit_pending ?? 0,
    },
  };
}

export interface RiskRow {
  readonly voteId: string;
  readonly candidateNumber: number;
  readonly acceptedAt: number;
  readonly reasons: readonly string[];
  readonly clientClass: string;
  readonly state: string;
  /** 같은 IP group을 묶어 보기 위한 짧은 내부 참조. 원문 IP가 아니다. */
  readonly ipGroup: string;
}

export async function listRisks(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  onlyState: string | null,
): Promise<readonly RiskRow[]> {
  requireRole(admin, ['OPERATOR', 'OWNER']);
  const campaign = await loadCampaign(env, campaignSlug);
  const rows = await env.DB.prepare(
    `SELECT v.id, c.public_number, v.accepted_at, r.reasons_json, r.client_class, r.ip_hmac,
            ${EFFECTIVE_STATE_SQL} AS state
       FROM votes v
       JOIN candidates c ON c.id = v.candidate_id
       LEFT JOIN vote_risk_signals r ON r.vote_id = v.id
      WHERE v.campaign_id = ? AND v.epoch = ?
      ORDER BY v.accepted_at DESC LIMIT 200`,
  )
    .bind(campaign.id, campaign.voting_epoch)
    .all<{
      id: string;
      public_number: number;
      accepted_at: number;
      reasons_json: string | null;
      client_class: string | null;
      ip_hmac: string | null;
      state: string;
    }>();

  return rows.results
    .map((row) => ({
      voteId: row.id,
      candidateNumber: row.public_number,
      acceptedAt: row.accepted_at,
      reasons: row.reasons_json === null ? [] : (JSON.parse(row.reasons_json) as string[]),
      clientClass: row.client_class ?? 'unknown',
      state: row.state,
      ipGroup: row.ip_hmac === null ? '' : row.ip_hmac.slice(0, 8),
    }))
    .filter((row) => onlyState === null || row.state === onlyState);
}

export interface DecisionInput {
  readonly voteId: string;
  readonly verdict: 'INCLUDED' | 'EXCLUDED';
  readonly reason: string;
  readonly makerId: string;
  readonly requestId: string;
}

/**
 * 판정은 append-only이며 원표 값을 바꾸지 않는다.
 * 초안 작성자와 승인자가 달라야 한다.
 */
export async function appendDecision(
  env: DataEnv,
  admin: AdminIdentity,
  input: DecisionInput,
): Promise<{ version: number }> {
  requireRole(admin, ['OPERATOR', 'OWNER']);
  if (input.reason.trim().length < 3) throw new DomainError('UNPROCESSABLE', '판정 사유가 필요합니다.');

  const last = await env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) AS version FROM vote_decisions WHERE vote_id = ?`,
  )
    .bind(input.voteId)
    .first<{ version: number }>();
  const version = (last?.version ?? 0) + 1;

  const now = Date.now();
  const approvalId = newId();
  const digest = await digestOf({ voteId: input.voteId, verdict: input.verdict, version });

  await env.DB.batch([
    approvalStatement(
      env,
      approvalId,
      { action: 'VOTE_DECISION', payloadDigest: digest, makerId: input.makerId, checkerId: admin.id },
      now,
    ),
    env.DB.prepare(
      `INSERT INTO vote_decisions(id, vote_id, version, verdict, reason, actor_id, approval_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), input.voteId, version, input.verdict, input.reason.trim(), admin.id, approvalId, now),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'VOTE_DECIDED',
        targetType: 'vote',
        targetId: input.voteId,
        outcome: 'SUCCESS',
        requestId: input.requestId,
        reason: input.reason.trim(),
        metadata: { verdict: input.verdict, version },
      },
      now,
    ),
  ]);
  return { version };
}
