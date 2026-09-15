import { DomainError, type CampaignState } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';
import { findCurrentSet } from './shortlist.js';

/**
 * 공개 전환 업무 명령.
 * 운영자는 '투표 시작', '결과 공개'만 누르고 내부 READY 단계는 서버가 한 작업으로 처리한다.
 * 담당자가 확인 후 실행하며, 실행 직전에 조건을 다시 확인한다.
 */

export type CampaignActionKind = 'OPEN_SUBMISSION' | 'OPEN_VOTING' | 'PUBLISH_RESULT' | 'ARCHIVE';

/**
 * 각 명령이 실제로 수행하는 내부 단계. 운영 화면에는 노출하지 않는다.
 * 진행 중인 접수·투표 종료도 같은 작업에 포함해 따로 마감 화면을 찾아가지 않게 한다.
 */
function stepsFor(action: CampaignActionKind, from: CampaignState): CampaignState[] {
  // 이미 지나온 단계는 넣지 않는다. 같은 상태로 다시 전이하면 trigger가 막는다.
  switch (action) {
    case 'OPEN_SUBMISSION':
      return ['SUBMISSION_OPEN'];
    case 'OPEN_VOTING': {
      // 공모가 진행 중이면 접수 종료까지 한 번에 처리한다.
      const all: CampaignState[] = ['SUBMISSION_CLOSED', 'VOTING_READY', 'VOTING_OPEN'];
      return trimPassed(all, from);
    }
    case 'PUBLISH_RESULT': {
      const all: CampaignState[] = ['VOTING_CLOSED', 'RESULT_READY', 'RESULT_PUBLISHED'];
      return trimPassed(all, from);
    }
    case 'ARCHIVE':
      return ['ARCHIVED'];
  }
}

/** 현재 상태가 목록 안에 있으면 그 다음 단계부터 실행한다. */
function trimPassed(steps: CampaignState[], from: CampaignState): CampaignState[] {
  const at = steps.indexOf(from);
  return at < 0 ? steps : steps.slice(at + 1);
}

export const ACTION_LABEL: Readonly<Record<CampaignActionKind, string>> = {
  OPEN_SUBMISSION: '공모 시작',
  OPEN_VOTING: '투표 시작',
  PUBLISH_RESULT: '결과 공개',
  ARCHIVE: '운영 종료',
};

export interface BlockedReason {
  readonly key: string;
  readonly message: string;
  /** 운영 화면에서 바로 고치러 갈 경로 */
  readonly resolutionHref: string | null;
}

export interface ActionSnapshot {
  readonly action: CampaignActionKind;
  readonly campaignRevision: number;
  readonly contentVersionIds: Record<string, string>;
  readonly candidateSetId: string | null;
  readonly candidateSetDigest: string | null;
  readonly resultId: string | null;
  readonly resultTallyDigest: string | null;
  readonly submissionStart: number | null;
  readonly submissionEnd: number | null;
  readonly votingStart: number | null;
  readonly votingEnd: number | null;
}

export interface ActionPreview {
  readonly action: CampaignActionKind;
  readonly label: string;
  readonly fromPublic: string;
  readonly toPublic: string;
  readonly participationAfter: string;
  readonly periodAfter: { start: number | null; end: number | null };
  readonly summary: readonly { label: string; value: string }[];
  /** 확인창에 그대로 보여줄 문구 목록 */
  readonly confirmList: readonly string[];
  /** 이미 지난 마감 일정을 함께 해제하는지 */
  readonly clearsStaleDeadline: boolean;
  readonly blockedReasons: readonly BlockedReason[];
  readonly allowed: boolean;
  readonly expectedRevision: number;
  readonly snapshot: ActionSnapshot;
  readonly snapshotDigest: string;
  readonly requiresOtherApprover: boolean;
}

/** 참여자가 보는 화면 이름. 서버 내부 상태 이름을 그대로 쓰지 않는다. */
export function publicStatusLabel(state: CampaignState, paused: boolean, effectiveClosed: 'NONE' | 'SUBMISSION' | 'VOTING'): string {
  if (paused) return '일시 중단';
  if (state === 'SUBMISSION_OPEN') return effectiveClosed === 'SUBMISSION' ? '공모 마감 · 심사 중' : '공모 접수 중';
  if (state === 'VOTING_OPEN') return effectiveClosed === 'VOTING' ? '투표 마감 · 결과 집계 중' : '투표 진행 중';
  switch (state) {
    case 'DRAFT':
      return '공개 전';
    case 'SUBMISSION_CLOSED':
      return '공모 마감 · 심사 중';
    case 'VOTING_READY':
      return '투표 준비 중';
    case 'VOTING_CLOSED':
      return '투표 마감 · 결과 집계 중';
    case 'RESULT_READY':
      return '투표 마감 · 결과 집계 중';
    case 'RESULT_PUBLISHED':
      return '결과 공개 중';
    case 'ARCHIVED':
      return '운영 종료';
  }
}

export function participationLabel(state: CampaignState, paused: boolean, effectiveClosed: 'NONE' | 'SUBMISSION' | 'VOTING'): string {
  if (paused) return '일시 중단';
  if (state === 'SUBMISSION_OPEN' && effectiveClosed !== 'SUBMISSION') return '응모 가능';
  if (state === 'VOTING_OPEN' && effectiveClosed !== 'VOTING') return '투표 가능';
  return '참여 마감';
}

/** 마감 시각이 지났는지 서버 시각으로 판단한다. 정리 작업이 늦어도 마감으로 본다. */
export function effectiveClosure(
  state: CampaignState,
  now: number,
  submissionEnd: number | null,
  votingEnd: number | null,
): 'NONE' | 'SUBMISSION' | 'VOTING' {
  if (state === 'SUBMISSION_OPEN' && submissionEnd !== null && now >= submissionEnd) return 'SUBMISSION';
  if (state === 'VOTING_OPEN' && votingEnd !== null && now >= votingEnd) return 'VOTING';
  return 'NONE';
}

/** 현재 상태에서 운영자가 할 수 있는 다음 공개 명령. 없으면 null. */
export function nextActionFor(state: CampaignState): CampaignActionKind | null {
  switch (state) {
    case 'DRAFT':
      return 'OPEN_SUBMISSION';
    // 공모가 진행 중이어도 같은 확인으로 종료하고 투표로 넘어간다.
    case 'SUBMISSION_OPEN':
    case 'SUBMISSION_CLOSED':
    case 'VOTING_READY':
      return 'OPEN_VOTING';
    case 'VOTING_OPEN':
    case 'VOTING_CLOSED':
    case 'RESULT_READY':
      return 'PUBLISH_RESULT';
    case 'RESULT_PUBLISHED':
      return 'ARCHIVE';
    default:
      return null;
  }
}

interface ContentPublicationRow {
  page: string;
  content_version_id: string;
}

async function loadPublications(env: DataEnv, campaignId: string): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(
    `SELECT page, content_version_id FROM content_publications WHERE campaign_id = ? AND locale = 'ko'`,
  )
    .bind(campaignId)
    .all<ContentPublicationRow>();
  return Object.fromEntries(rows.results.map((row) => [row.page, row.content_version_id]));
}

/**
 * 명령 실행 조건을 확인한다. 데이터는 바꾸지 않는다.
 * 부족한 항목마다 고치러 갈 경로를 함께 돌려준다.
 */
export async function previewAction(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  action: CampaignActionKind,
): Promise<ActionPreview> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  const closure = effectiveClosure(campaign.state, now, campaign.submission_end, campaign.voting_end);
  const blocked: BlockedReason[] = [];
  const publications = await loadPublications(env, campaign.id);

  const expected = nextActionFor(campaign.state);
  if (expected !== action && !(action === 'OPEN_SUBMISSION' && campaign.state !== 'SUBMISSION_OPEN')) {
    blocked.push({
      key: 'wrong_stage',
      message: `지금 단계에서는 ${ACTION_LABEL[action]}을(를) 할 수 없습니다.`,
      resolutionHref: '/dashboard',
    });
  }

  let candidateSetId: string | null = null;
  let candidateSetDigest: string | null = null;
  let resultId: string | null = null;
  const summary: { label: string; value: string }[] = [];
  const confirmList: string[] = [];

  if (action === 'OPEN_SUBMISSION') {
    if (campaign.state !== 'DRAFT') {
      summary.push({ label: '테스트용 전환', value: '공모 접수를 다시 엽니다. 기존 응모작·후보·투표·결과 기록은 보존됩니다. 투표 이력과 중복투표 제한도 유지됩니다.' });
    }
    summary.push({ label: '공모 기간', value: formatRange(campaign.submission_start, campaign.submission_end) });
  }

  if (action === 'OPEN_VOTING') {
    // 확정된 후보가 있어야 한다. 이것이 유일한 준비 조건이다.
    const set = await env.DB.prepare(
      `SELECT id, status, digest FROM candidate_sets WHERE campaign_id = ? AND epoch = ? ORDER BY revision DESC LIMIT 1`,
    )
      .bind(campaign.id, Math.max(campaign.voting_epoch, 1))
      .first<{ id: string; status: string; digest: string | null }>();

    if (set === null || set.status !== 'FROZEN') {
      blocked.push({
        key: 'candidates',
        message: '숏리스트에서 후보를 확정해주세요.',
        resolutionHref: '/voting/candidates',
      });
    } else {
      candidateSetId = set.id;
      candidateSetDigest = set.digest;
      const rows = await env.DB.prepare(
        `SELECT public_message FROM candidates WHERE set_id = ? ORDER BY display_order`,
      )
        .bind(set.id)
        .all<{ public_message: string }>();
      for (const row of rows.results) confirmList.push(row.public_message);
      summary.push({ label: '확정 후보', value: `${rows.results.length}개` });

      // 확정 이후 후보 지정이 바뀌었는지 확인한다.
      const prepared = await env.DB.prepare(
        `SELECT id, message, candidate_order FROM submissions
          WHERE campaign_id = ? AND status = 'CANDIDATE'
          ORDER BY COALESCE(candidate_order, 999999), accepted_at`,
      )
        .bind(campaign.id)
        .all<{ id: string; message: string; candidate_order: number | null }>();
      const currentDigest = await digestOf(
        prepared.results.map((row, index) => ({
          id: row.id,
          message: row.message,
          order: row.candidate_order ?? index,
        })),
      );
      if (set.digest !== currentDigest) {
        blocked.push({
          key: 'stale_candidates',
          message: '후보가 변경되었습니다. 숏리스트에서 다시 확정해주세요.',
          resolutionHref: '/voting/candidates',
        });
      }
    }
    if (campaign.state === 'SUBMISSION_OPEN') {
      summary.push({ label: '함께 처리', value: '전환하면 공모 접수가 종료됩니다.' });
    }
    summary.push({ label: '투표 기간', value: formatRange(campaign.voting_start, campaign.voting_end) });
  }

  if (action === 'PUBLISH_RESULT') {
    // 확정된 최종 문구만 있으면 된다. 점수·근거·미판정 표는 조건에서 뺀다.
    const result = await env.DB.prepare(
      `SELECT r.id, c.public_message FROM result_versions r JOIN candidates c ON c.id = r.winner_candidate_id
        WHERE r.campaign_id = ? AND r.status IN ('DRAFT','APPROVED','PUBLISHED') ORDER BY r.version DESC LIMIT 1`,
    )
      .bind(campaign.id)
      .first<{ id: string; public_message: string }>();
    if (result === null) {
      blocked.push({
        key: 'final_message',
        message: '최종 문구를 먼저 선택·확정해주세요.',
        resolutionHref: '/results/final',
      });
    } else {
      resultId = result.id;
      confirmList.push(result.public_message);
      summary.push({ label: '최종 문구', value: result.public_message });
    }
    if (campaign.state === 'VOTING_OPEN') {
      summary.push({ label: '함께 처리', value: '전환하면 투표 접수가 종료됩니다.' });
    }
  }

  if (action === 'ARCHIVE') {
    summary.push({ label: '결과 화면', value: '운영을 종료해도 공개된 결과는 그대로 유지됩니다.' });
  }

  // 이미 지난 마감 일정은 전환과 함께 해제한다.
  const staleDeadline =
    (action === 'OPEN_SUBMISSION' && campaign.submission_end !== null && now >= campaign.submission_end) ||
    (action === 'OPEN_VOTING' && campaign.voting_end !== null && now >= campaign.voting_end);
  if (staleDeadline) {
    summary.push({
      label: '기존 마감 일정',
      value: '이미 지난 마감 일정은 해제되며 수동으로 종료할 때까지 진행됩니다.',
    });
  }

  const snapshot: ActionSnapshot = {
    action,
    campaignRevision: campaign.revision,
    contentVersionIds: publications,
    candidateSetId,
    candidateSetDigest,
    resultId,
    resultTallyDigest: null,
    submissionStart: campaign.submission_start,
    submissionEnd: campaign.submission_end,
    votingStart: campaign.voting_start,
    votingEnd: campaign.voting_end,
  };

  const steps = stepsFor(action, campaign.state);
  const toState = steps[steps.length - 1]!;
  return {
    action,
    label: ACTION_LABEL[action],
    fromPublic: publicStatusLabel(campaign.state, campaign.paused === 1, closure),
    toPublic: publicStatusLabel(toState, false, 'NONE'),
    participationAfter: participationLabel(toState, false, 'NONE'),
    periodAfter:
      action === 'OPEN_SUBMISSION'
        ? { start: campaign.submission_start, end: campaign.submission_end }
        : action === 'OPEN_VOTING'
          ? { start: campaign.voting_start, end: campaign.voting_end }
          : { start: null, end: null },
    summary,
    confirmList,
    clearsStaleDeadline: staleDeadline,
    blockedReasons: blocked,
    allowed: blocked.length === 0,
    expectedRevision: campaign.revision,
    snapshot,
    snapshotDigest: await digestOf(snapshot),
    requiresOtherApprover: false,
  };
}

function formatRange(start: number | null, end: number | null): string {
  if (start === null || end === null) return '미정';
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return `${fmt(start)} ~ ${fmt(end)} (KST)`;
}

export interface ActionRecord {
  readonly id: string;
  readonly action: CampaignActionKind;
  readonly label: string;
  readonly status: 'REQUESTED' | 'EXECUTED' | 'CANCELLED';
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedByEmail: string;
  readonly requestedAt: number;
  readonly executedByEmail: string | null;
  readonly executedAt: number | null;
  readonly cancelReason: string | null;
  /** 요청 이후 관련 자료가 바뀌었는지 */
  readonly stale: boolean;
}

async function toRecord(env: DataEnv, row: ActionRow, currentDigest: string | null): Promise<ActionRecord> {
  return {
    id: row.id,
    action: row.action,
    label: ACTION_LABEL[row.action],
    status: row.status,
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedByEmail: row.requested_email ?? '',
    requestedAt: row.requested_at,
    executedByEmail: row.executed_email,
    executedAt: row.executed_at,
    cancelReason: row.cancel_reason,
    stale: row.status === 'REQUESTED' && currentDigest !== null && currentDigest !== row.snapshot_digest,
  };
}

interface ActionRow {
  id: string;
  action: CampaignActionKind;
  status: 'REQUESTED' | 'EXECUTED' | 'CANCELLED';
  snapshot_json: string;
  snapshot_digest: string;
  expected_revision: number;
  reason: string;
  requested_by: string;
  requested_at: number;
  executed_at: number | null;
  cancel_reason: string | null;
  requested_email: string | null;
  executed_email: string | null;
}

const ACTION_SELECT = `
  SELECT a.id, a.action, a.status, a.snapshot_json, a.snapshot_digest, a.expected_revision, a.reason,
         a.requested_by, a.requested_at, a.executed_at, a.cancel_reason,
         r.email AS requested_email, e.email AS executed_email
    FROM campaign_actions a
    LEFT JOIN administrators r ON r.id = a.requested_by
    LEFT JOIN administrators e ON e.id = a.executed_by`;

/**
 * 공개 전환을 실행한다.
 * 담당자 한 명이 확인 한 번으로 끝낸다. 요청과 실행을 나누지 않는다.
 *
 * 조건 재검증 → 필요한 내부 단계 전부 → 결과 공개 포인터 → 지난 마감 일정 해제 → 감사 기록을
 * 하나의 D1 batch로 처리한다. 확인창 이후 조건이 바뀌면 guard가 batch 전체를 되돌린다.
 *
 * `expectedSnapshotDigest`는 운영자가 확인창에서 실제로 본 내용의 지문이다.
 * 확인창을 띄운 뒤 다른 창에서 최종 문구나 후보를 바꾸면 campaign revision은 그대로여도
 * 공개될 내용이 달라진다. 그래서 revision만으로는 부족하고 본 내용 자체를 비교한다.
 */
export async function executeAction(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  action: CampaignActionKind,
  idempotencyKey: string,
  expectedRevision: number,
  expectedSnapshotDigest: string,
  requestId: string,
): Promise<{ state: CampaignState; revision: number; actionId: string }> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);

  // 같은 key로 이미 처리했으면 그 결과를 그대로 돌려준다.
  const existing = await env.DB.prepare(
    `SELECT id, status, result_json FROM campaign_actions
      WHERE campaign_id = ? AND action = ? AND idempotency_key = ?`,
  )
    .bind(campaign.id, action, idempotencyKey)
    .first<{ id: string; status: string; result_json: string | null }>();
  if (existing !== null && existing.status === 'EXECUTED') {
    const saved = JSON.parse(existing.result_json ?? '{}') as { state?: CampaignState; revision?: number };
    return {
      state: saved.state ?? (campaign.state as CampaignState),
      revision: saved.revision ?? campaign.revision,
      actionId: existing.id,
    };
  }

  if (campaign.revision !== expectedRevision) {
    throw new DomainError('CONFLICT', '설정이 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
  }

  const preview = await previewAction(env, admin, campaignSlug, action);
  if (!preview.allowed) {
    throw new DomainError('CONFLICT', preview.blockedReasons.map((b) => b.message).join(' / '));
  }

  // 확인창에서 본 내용과 지금 공개될 내용이 같은지 본다. 다르면 실행하지 않고 다시 확인시킨다.
  if (expectedSnapshotDigest.length === 0) {
    throw new DomainError('BAD_REQUEST', '확인한 내용을 함께 보내야 합니다. 화면을 새로고침해주세요.');
  }
  if (expectedSnapshotDigest !== preview.snapshotDigest) {
    throw new DomainError(
      'CONFLICT',
      '확인창을 띄운 뒤 공개될 내용이 바뀌었습니다. 바뀐 내용을 다시 확인해주세요.',
    );
  }

  const snapshot = preview.snapshot;
  const now = Date.now();
  /**
   * DB trigger는 초 단위 시각(strftime)으로 기간을 검사한다.
   * 시작 시각을 밀리초 그대로 저장하면 전환 직후 1초 동안 접수·투표가 거부되므로
   * 시작 시각만 초 단위로 내려 맞춘다.
   */
  const startAt = Math.floor(now / 1000) * 1000;
  const steps = stepsFor(action, campaign.state as CampaignState);
  const actionId = existing?.id ?? newId();
  const guardId = newId();

  const statements: D1PreparedStatement[] = [];

  if (existing === null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO campaign_actions(id, campaign_id, action, status, snapshot_json, snapshot_digest,
                                      expected_revision, reason, requested_by, requested_at, idempotency_key)
         VALUES (?, ?, ?, 'REQUESTED', ?, ?, ?, '', ?, ?, ?)`,
      ).bind(
        actionId,
        campaign.id,
        action,
        JSON.stringify(snapshot),
        preview.snapshotDigest,
        expectedRevision,
        admin.id,
        now,
        idempotencyKey,
      ),
    );
  }

  /*
   * 확인창 이후 내용이 바뀌지 않았는지 같은 batch 안에서 다시 본다.
   * 위의 digest 비교는 batch 바깥이라 그 사이에 바뀔 수 있다(TOCTOU).
   * 여기서는 '그 대상이 아직 최신인지'까지 조건부 쓰기로 확인하고,
   * 어긋나면 CHECK(ok=1)이 batch 전체를 되돌린다.
   */
  if (action === 'OPEN_VOTING' && snapshot.candidateSetId !== null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM candidate_sets s
            WHERE s.id = ? AND s.status = 'FROZEN' AND s.digest = ?
              AND s.revision = (SELECT MAX(revision) FROM candidate_sets
                                 WHERE campaign_id = s.campaign_id AND epoch = s.epoch)
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, snapshot.candidateSetId, snapshot.candidateSetDigest),
    );
  } else if (action === 'PUBLISH_RESULT' && snapshot.resultId !== null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM result_versions r
            WHERE r.id = ? AND r.status IN ('DRAFT','APPROVED','PUBLISHED')
              AND r.version = (SELECT MAX(version) FROM result_versions
                                WHERE campaign_id = r.campaign_id
                                  AND status IN ('DRAFT','APPROVED','PUBLISHED'))
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, snapshot.resultId),
    );
  } else {
    statements.push(env.DB.prepare(`INSERT INTO operation_guards(id, ok) VALUES (?, 1)`).bind(guardId));
  }

  // 내부 단계를 순서대로 넣는다. trigger가 state와 revision을 올린다.
  let fromState = campaign.state as CampaignState;
  let revision = campaign.revision;
  for (const toState of steps) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO transition_events(id, campaign_id, from_state, to_state, expected_revision, actor_id, approval_id, reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).bind(newId(), campaign.id, fromState, toState, revision, admin.id, ACTION_LABEL[action], now),
      env.DB.prepare(
        `INSERT INTO campaign_revisions(campaign_id, revision, config_json, digest, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        campaign.id,
        revision + 1,
        JSON.stringify({ state: toState, action }),
        preview.snapshotDigest,
        admin.id,
        now,
      ),
    );
    fromState = toState;
    revision += 1;
  }

  // 담당자의 시작 확인이 개시 승인이다. 기존 DB gate가 읽는 승인값도 같은 batch에서 맞춘다.
  // 시작 시각은 실제 전환 시각으로 기록하고, 이미 지난 마감 일정은 해제한다.
  if (action === 'OPEN_SUBMISSION') {
    statements.push(
      env.DB.prepare(
        `UPDATE campaigns SET paused = 0, launch_approved = 1, submission_start = ?, submission_end = CASE WHEN submission_end IS NOT NULL AND submission_end <= ? THEN NULL ELSE submission_end END, updated_at = ? WHERE id = ?`,
      ).bind(startAt, now, now, campaign.id),
    );
  }
  if (action === 'OPEN_VOTING') {
    statements.push(
      env.DB.prepare(
        `UPDATE campaigns SET launch_approved = 1, voting_start = ?, voting_end = CASE WHEN voting_end IS NOT NULL AND voting_end <= ? THEN NULL ELSE voting_end END, updated_at = ? WHERE id = ?`,
      ).bind(startAt, now, now, campaign.id),
    );
  }

  // 결과 공개는 같은 batch에서 게시 상태까지 바꾼다.
  if (action === 'PUBLISH_RESULT' && snapshot.resultId !== null) {
    statements.push(
      env.DB.prepare(
        `UPDATE result_versions SET status = 'SUPERSEDED' WHERE campaign_id = ? AND status = 'PUBLISHED' AND id <> ?`,
      ).bind(campaign.id, snapshot.resultId),
      env.DB.prepare(`UPDATE result_versions SET status = 'PUBLISHED', published_at = ? WHERE id = ?`).bind(
        now,
        snapshot.resultId,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `UPDATE campaign_actions SET status = 'EXECUTED', executed_by = ?, executed_at = ?, result_json = ?
        WHERE id = ? AND status = 'REQUESTED'`,
    ).bind(admin.id, now, JSON.stringify({ state: fromState, revision }), actionId),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'CAMPAIGN_ACTION_EXECUTED',
        targetType: 'campaign_action',
        targetId: actionId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { kind: action, toState: fromState },
      },
      now,
    ),
    env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId),
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('REVISION_CONFLICT')) {
      throw new DomainError('CONFLICT', '설정이 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    if (text.includes('ILLEGAL_TRANSITION')) throw new DomainError('CONFLICT', '지금 단계에서는 할 수 없는 작업입니다.');
    if (text.includes('ACTION_STATUS_GATE')) throw new DomainError('CONFLICT', '이미 처리된 작업입니다.');
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '확인 이후 내용이 바뀌었습니다. 다시 확인해주세요.');
    }
    if (text.includes('UNIQUE constraint failed: campaign_actions')) {
      throw new DomainError('CONFLICT', '이미 처리 중인 작업입니다.');
    }
    throw error;
  }

  return { state: fromState, revision, actionId };
}
