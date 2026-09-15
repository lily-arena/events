import { DomainError, canTransition, type CampaignState } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { approvalStatement, auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 캠페인 설정·상태 전환. 이전 phase로 돌아가는 일반 API는 없다.
 * KST 입력은 Admin 화면에서 처리하고 저장은 UTC millisecond로 한다.
 */

export interface CampaignConfigInput {
  readonly campaignSlug: string;
  readonly maxMessageLength: number;
  readonly submissionStart: number | null;
  readonly submissionEnd: number | null;
  readonly votingStart: number | null;
  readonly votingEnd: number | null;
  readonly absolutePiiDeadline: number | null;
  readonly expectedRevision: number;
  readonly requestId: string;
}

export interface CampaignAdminView {
  readonly id: string;
  readonly slug: string;
  readonly state: CampaignState;
  readonly paused: boolean;
  readonly revision: number;
  readonly epoch: number;
  readonly launchApproved: boolean;
  readonly maxMessageLength: number;
  readonly submissionStart: number | null;
  readonly submissionEnd: number | null;
  readonly votingStart: number | null;
  readonly votingEnd: number | null;
  readonly absolutePiiDeadline: number | null;
}

export async function getCampaignAdmin(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<CampaignAdminView> {
  requireRole(admin, ['OPERATOR', 'OWNER', 'REVIEWER', 'AUDITOR', 'PII_OFFICER']);
  const row = await loadCampaign(env, campaignSlug);
  const extra = await env.DB.prepare(`SELECT absolute_pii_deadline FROM campaigns WHERE id = ?`)
    .bind(row.id)
    .first<{ absolute_pii_deadline: number | null }>();
  return {
    id: row.id,
    slug: row.slug,
    state: row.state,
    paused: row.paused === 1,
    revision: row.revision,
    epoch: row.voting_epoch,
    launchApproved: row.launch_approved === 1,
    maxMessageLength: row.max_message_length,
    submissionStart: row.submission_start,
    submissionEnd: row.submission_end,
    votingStart: row.voting_start,
    votingEnd: row.voting_end,
    absolutePiiDeadline: extra?.absolute_pii_deadline ?? null,
  };
}

export async function updateConfig(
  env: DataEnv,
  admin: AdminIdentity,
  input: CampaignConfigInput,
): Promise<{ revision: number }> {
  requireRole(admin, ['OWNER']);
  if (input.maxMessageLength < 1 || input.maxMessageLength > 100) {
    throw new DomainError('UNPROCESSABLE', '문구 길이는 1–100자 범위여야 합니다.');
  }
  if (input.submissionEnd !== null && input.submissionStart !== null && input.submissionStart >= input.submissionEnd) {
    throw new DomainError('UNPROCESSABLE', '접수 시작은 마감보다 앞서야 합니다.');
  }
  if (input.votingEnd !== null && input.votingStart !== null && input.votingStart >= input.votingEnd) {
    throw new DomainError('UNPROCESSABLE', '투표 시작은 마감보다 앞서야 합니다.');
  }

  const campaign = await loadCampaign(env, input.campaignSlug);
  const now = Date.now();
  const nextRevision = campaign.revision + 1;
  const config = {
    maxMessageLength: input.maxMessageLength,
    submissionStart: input.submissionStart,
    submissionEnd: input.submissionEnd,
    votingStart: input.votingStart,
    votingEnd: input.votingEnd,
    absolutePiiDeadline: input.absolutePiiDeadline,
  };
  const digest = await digestOf(config);
  const guardId = newId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM campaigns WHERE id = ? AND revision = ?
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, campaign.id, input.expectedRevision),
      env.DB.prepare(
        `UPDATE campaigns SET max_message_length = ?, submission_start = ?, submission_end = ?,
                              voting_start = ?, voting_end = ?, absolute_pii_deadline = ?,
                              revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ?`,
      ).bind(
        input.maxMessageLength,
        input.submissionStart,
        input.submissionEnd,
        input.votingStart,
        input.votingEnd,
        input.absolutePiiDeadline,
        now,
        campaign.id,
        input.expectedRevision,
      ),
      // revision이 오르면 같은 batch에 snapshot을 남긴다. 과거 접수의 FK는 그대로 둔다.
      env.DB.prepare(
        `INSERT INTO campaign_revisions(campaign_id, revision, config_json, digest, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(campaign.id, nextRevision, JSON.stringify(config), digest, admin.id, now),
      ...auditStatements(
        env,
        {
          actorId: admin.id,
          action: 'CAMPAIGN_CONFIG_UPDATED',
          targetType: 'campaign',
          targetId: campaign.id,
          outcome: 'SUCCESS',
          requestId: input.requestId,
          metadata: { revision: nextRevision, digest },
        },
        now,
      ),
      env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '설정이 변경되었습니다. 최신 상태를 확인해주세요.');
    }
    throw error;
  }
  return { revision: nextRevision };
}

/** 긴급 중단은 Operator도 할 수 있고 해제는 Owner만 가능하다. 마감 이후에는 해제해도 재개되지 않는다. */
export async function setPaused(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  paused: boolean,
  requestId: string,
): Promise<{ paused: boolean }> {
  requireRole(admin, paused ? ['OPERATOR', 'OWNER'] : ['OWNER']);
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE campaigns SET paused = ?, updated_at = ? WHERE id = ?`).bind(
      paused ? 1 : 0,
      now,
      campaign.id,
    ),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: paused ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_RESUMED',
        targetType: 'campaign',
        targetId: campaign.id,
        outcome: 'SUCCESS',
        requestId,
      },
      now,
    ),
  ]);
  return { paused };
}

export interface GuardResult {
  readonly key: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface TransitionPreview {
  readonly from: CampaignState;
  readonly to: CampaignState;
  readonly expectedRevision: number;
  readonly guards: readonly GuardResult[];
  readonly allowed: boolean;
}

/** 전이 전 업무 guard를 평가한다. SQL이 강제하지 않는 조건을 여기서 확인한다. */
export async function previewTransition(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  to: CampaignState,
): Promise<TransitionPreview> {
  requireRole(admin, ['OPERATOR', 'OWNER']);
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  const guards: GuardResult[] = [];

  const graphOk = canTransition(campaign.state, to);
  guards.push({
    key: 'transition_graph',
    ok: graphOk,
    detail: `${campaign.state} → ${to}`,
  });

  if (to === 'SUBMISSION_OPEN') {
    guards.push({
      key: 'schedule',
      ok: campaign.submission_start !== null && campaign.submission_end !== null,
      detail: '접수 기간이 설정되어야 합니다.',
    });
    guards.push({
      key: 'launch_approved',
      ok: campaign.launch_approved === 1,
      detail: '운영 개시 승인이 필요합니다.',
    });
    const content = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM content_publications WHERE campaign_id = ? AND page IN ('SUBMISSION','SUBMITTED')`,
    )
      .bind(campaign.id)
      .first<{ n: number }>();
    guards.push({ key: 'content_published', ok: (content?.n ?? 0) >= 2, detail: '공모·접수완료 콘텐츠 게시 필요' });
    const policies = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM campaign_policies WHERE campaign_id = ? AND required = 1`,
    )
      .bind(campaign.id)
      .first<{ n: number }>();
    guards.push({ key: 'required_policies', ok: (policies?.n ?? 0) >= 2, detail: '필수 동의 정책 필요' });
  }

  if (to === 'SUBMISSION_CLOSED') {
    guards.push({
      key: 'submission_end_reached',
      ok: campaign.submission_end !== null && now >= campaign.submission_end,
      detail: '마감 시각 도달 또는 조기 종료 사유 필요',
    });
  }

  if (to === 'VOTING_READY') {
    const set = await env.DB.prepare(
      `SELECT status FROM candidate_sets WHERE campaign_id = ? AND epoch = ?`,
    )
      .bind(campaign.id, campaign.voting_epoch)
      .first<{ status: string }>();
    guards.push({ key: 'set_frozen', ok: set?.status === 'FROZEN', detail: '후보 set 동결 필요' });
    const voting = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM content_publications WHERE campaign_id = ? AND page IN ('VOTING','VOTED')`,
    )
      .bind(campaign.id)
      .first<{ n: number }>();
    guards.push({ key: 'voting_content', ok: (voting?.n ?? 0) >= 2, detail: '투표·투표완료 콘텐츠 게시 필요' });
    guards.push({
      key: 'voting_schedule',
      ok: campaign.voting_start !== null && campaign.voting_end !== null,
      detail: '투표 기간 설정 필요',
    });
  }

  if (to === 'VOTING_OPEN') {
    guards.push({
      key: 'voting_start_reached',
      ok: campaign.voting_start !== null && now >= campaign.voting_start,
      detail: '투표 시작 시각 도달 필요',
    });
  }

  if (to === 'VOTING_CLOSED') {
    guards.push({
      key: 'voting_end_reached',
      ok: campaign.voting_end !== null && now >= campaign.voting_end,
      detail: '투표 마감 시각 도달 또는 조기 종료 사유 필요',
    });
  }

  if (to === 'RESULT_READY') {
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM votes v
        WHERE v.campaign_id = ? AND v.epoch = ?
          AND COALESCE((SELECT d.verdict FROM vote_decisions d WHERE d.vote_id = v.id ORDER BY d.version DESC LIMIT 1),
                       v.initial_review_state) = 'PENDING'`,
    )
      .bind(campaign.id, campaign.voting_epoch)
      .first<{ n: number }>();
    guards.push({ key: 'no_pending_votes', ok: (pending?.n ?? 0) === 0, detail: '미판정 표가 없어야 합니다.' });
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM result_versions WHERE campaign_id = ? AND status IN ('DRAFT','APPROVED')`,
    )
      .bind(campaign.id)
      .first<{ n: number }>();
    guards.push({ key: 'result_draft', ok: (result?.n ?? 0) > 0, detail: '결과 초안 필요' });
  }

  if (to === 'RESULT_PUBLISHED') {
    guards.push({
      key: 'publish_endpoint',
      ok: false,
      detail: '결과 게시는 /api/admin/results/{id}/publish 로만 수행합니다.',
    });
  }

  if (to === 'ARCHIVED') {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM deletion_jobs WHERE campaign_id = ? AND state NOT IN ('VERIFIED')`,
    )
      .bind(campaign.id)
      .first<{ n: number }>();
    guards.push({ key: 'deletion_complete', ok: (remaining?.n ?? 0) === 0, detail: '미완료 파기 job 없음' });
  }

  return {
    from: campaign.state,
    to,
    expectedRevision: campaign.revision,
    guards,
    allowed: guards.every((g) => g.ok),
  };
}

export async function commitTransition(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  to: CampaignState,
  reason: string,
  expectedRevision: number,
  requestId: string,
): Promise<{ state: CampaignState; revision: number }> {
  requireRole(admin, ['OWNER']);
  const preview = await previewTransition(env, admin, campaignSlug, to);
  if (!preview.allowed) {
    const failed = preview.guards.filter((g) => !g.ok).map((g) => g.detail);
    throw new DomainError('CONFLICT', `전환 조건 미충족: ${failed.join(' / ')}`);
  }
  if (preview.expectedRevision !== expectedRevision) {
    throw new DomainError('CONFLICT', '설정이 변경되었습니다. 최신 상태를 확인해주세요.');
  }
  if (reason.trim().length < 3) throw new DomainError('UNPROCESSABLE', '전환 사유가 필요합니다.');

  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  const digest = await digestOf({ from: preview.from, to, expectedRevision });
  const approvalId = newId();

  try {
    await env.DB.batch([
      approvalStatement(
        env,
        approvalId,
        {
          action: 'CAMPAIGN_TRANSITION',
          payloadDigest: digest,
          // 전환 승인은 초안 작성자와 달라야 하므로 직전 설정 작성자를 maker로 본다.
          makerId: await lastConfigActor(env, campaign.id, admin.id),
          checkerId: admin.id,
        },
        now,
      ),
      // trigger가 state·revision을 갱신한다.
      env.DB.prepare(
        `INSERT INTO transition_events(id, campaign_id, from_state, to_state, expected_revision, actor_id, approval_id, reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), campaign.id, preview.from, to, expectedRevision, admin.id, approvalId, reason.trim(), now),
      env.DB.prepare(
        `INSERT INTO campaign_revisions(campaign_id, revision, config_json, digest, actor_id, approval_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        campaign.id,
        expectedRevision + 1,
        JSON.stringify({ state: to, reason: reason.trim() }),
        digest,
        admin.id,
        approvalId,
        now,
      ),
      ...auditStatements(
        env,
        {
          actorId: admin.id,
          action: 'CAMPAIGN_TRANSITIONED',
          targetType: 'campaign',
          targetId: campaign.id,
          outcome: 'SUCCESS',
          requestId,
          reason: reason.trim(),
          metadata: { from: preview.from, to },
        },
        now,
      ),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('REVISION_CONFLICT')) throw new DomainError('CONFLICT', '설정이 변경되었습니다.');
    if (text.includes('ILLEGAL_TRANSITION')) throw new DomainError('CONFLICT', '허용되지 않은 상태 전환입니다.');
    throw error;
  }
  return { state: to, revision: expectedRevision + 1 };
}

/** 직전 설정 변경자를 찾는다. 없으면 다른 Owner를 maker로 쓴다. */
async function lastConfigActor(env: DataEnv, campaignId: string, checkerId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT actor_id FROM campaign_revisions WHERE campaign_id = ? AND actor_id <> ?
      ORDER BY revision DESC LIMIT 1`,
  )
    .bind(campaignId, checkerId)
    .first<{ actor_id: string }>();
  if (row !== null) return row.actor_id;
  const other = await env.DB.prepare(
    `SELECT a.id FROM administrators a JOIN admin_roles r ON r.admin_id = a.id
      WHERE r.role = 'OWNER' AND a.id <> ? AND a.active = 1 LIMIT 1`,
  )
    .bind(checkerId)
    .first<{ id: string }>();
  if (other === null) {
    throw new DomainError('FORBIDDEN', '승인할 다른 운영 관리자가 필요합니다.');
  }
  return other.id;
}
