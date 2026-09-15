import { DomainError } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 숏리스트.
 * 심사에서 '후보'로 지정한 응모작이 곧바로 준비 목록에 나타난다.
 * 별도 후보 묶음 만들기, 권리 확인, 가중치·동점 기준 입력은 없다.
 * 확정은 현재 목록을 한 번 확인하는 것이며 그것만으로 투표가 공개되지는 않는다.
 */

export interface ShortlistEntry {
  readonly submissionId: string;
  readonly message: string;
  readonly order: number;
}

export interface ShortlistView {
  /** 심사에서 후보로 지정한 문구. 이 목록이 준비 상태의 단일 원천이다. */
  readonly prepared: readonly ShortlistEntry[];
  /** 확정된 투표 후보. 확정 이후 준비 목록이 바뀌면 낡은 상태가 된다. */
  readonly confirmed: readonly { candidateId: string; message: string; number: number }[];
  readonly confirmedAt: number | null;
  readonly stale: boolean;
  /** 투표가 시작되어 후보를 더 이상 바꿀 수 없는 상태 */
  readonly locked: boolean;
  readonly setId: string | null;
  /** 화면이 지금 보고 있는 준비 목록의 지문. 확정할 때 함께 보내 서버가 대조한다. */
  readonly preparedDigest: string;
}

/** 준비 목록의 지문. 확정본과 비교해 다시 확정이 필요한지 판단한다. */
async function preparedDigest(entries: readonly ShortlistEntry[]): Promise<string> {
  return digestOf(entries.map((e) => ({ id: e.submissionId, message: e.message, order: e.order })));
}

async function loadPrepared(env: DataEnv, campaignId: string): Promise<ShortlistEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT id, message, candidate_order FROM submissions
      WHERE campaign_id = ? AND status = 'CANDIDATE'
      ORDER BY COALESCE(candidate_order, 999999), accepted_at`,
  )
    .bind(campaignId)
    .all<{ id: string; message: string; candidate_order: number | null }>();
  return rows.results.map((row, index) => ({
    submissionId: row.id,
    message: row.message,
    order: row.candidate_order ?? index,
  }));
}

export async function getShortlist(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<ShortlistView> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const prepared = await loadPrepared(env, campaign.id);

  const set = await env.DB.prepare(
    `SELECT id, status, digest, frozen_at FROM candidate_sets
      WHERE campaign_id = ? AND epoch = ? ORDER BY revision DESC LIMIT 1`,
  )
    .bind(campaign.id, Math.max(campaign.voting_epoch, 1))
    .first<{ id: string; status: string; digest: string | null; frozen_at: number | null }>();

  const confirmed =
    set === null
      ? []
      : (
          await env.DB.prepare(
            `SELECT id, public_message, public_number FROM candidates WHERE set_id = ? ORDER BY display_order`,
          )
            .bind(set.id)
            .all<{ id: string; public_message: string; public_number: number }>()
        ).results.map((row) => ({ candidateId: row.id, message: row.public_message, number: row.public_number }));

  const locked = ['VOTING_OPEN', 'VOTING_CLOSED', 'RESULT_READY', 'RESULT_PUBLISHED', 'ARCHIVED'].includes(
    campaign.state,
  );
  const currentDigest = await preparedDigest(prepared);
  const stale = set !== null && set.status === 'FROZEN' && !locked && set.digest !== currentDigest;

  return {
    prepared,
    confirmed,
    confirmedAt: set?.frozen_at ?? null,
    stale,
    locked,
    setId: set?.id ?? null,
    preparedDigest: currentDigest,
  };
}

/** 준비 목록의 순서를 바꾼다. 투표가 시작된 뒤에는 바꿀 수 없다. */
export async function reorderShortlist(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  orderedSubmissionIds: readonly string[],
  requestId: string,
): Promise<ShortlistView> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  if (['VOTING_OPEN', 'VOTING_CLOSED', 'RESULT_READY', 'RESULT_PUBLISHED', 'ARCHIVED'].includes(campaign.state)) {
    throw new DomainError('CONFLICT', '투표가 시작된 후에는 후보 순서를 바꿀 수 없습니다.');
  }
  const now = Date.now();
  const statements = orderedSubmissionIds.map((id, index) =>
    env.DB.prepare(
      `UPDATE submissions SET candidate_order = ? WHERE id = ? AND campaign_id = ? AND status = 'CANDIDATE'`,
    ).bind(index, id, campaign.id),
  );
  statements.push(
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'SHORTLIST_REORDERED',
        targetType: 'campaign',
        targetId: campaign.id,
        outcome: 'SUCCESS',
        requestId,
        metadata: { count: orderedSubmissionIds.length },
      },
      now,
    ),
  );
  await env.DB.batch(statements);
  return getShortlist(env, admin, campaignSlug);
}

/**
 * 현재 준비 목록을 투표 후보로 확정한다.
 * 문구·순서의 snapshot을 저장하며 권리 확인이나 사유 입력을 요구하지 않는다.
 */
/**
 * 후보를 확정한다.
 *
 * `expectedPreparedDigest`는 운영자가 목록에서 실제로 본 준비 목록의 지문이다.
 * 확인하는 사이에 심사 화면에서 후보 지정이 바뀌면 본 것과 다른 목록이 확정되므로 막는다.
 */
export async function confirmShortlist(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  expectedPreparedDigest: string,
  requestId: string,
): Promise<ShortlistView> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  if (['VOTING_OPEN', 'VOTING_CLOSED', 'RESULT_READY', 'RESULT_PUBLISHED', 'ARCHIVED'].includes(campaign.state)) {
    throw new DomainError('CONFLICT', '투표가 시작된 후에는 후보를 다시 확정할 수 없습니다.');
  }

  const prepared = await loadPrepared(env, campaign.id);
  if (prepared.length === 0) {
    throw new DomainError('UNPROCESSABLE', '후보로 지정한 문구가 없습니다. 심사에서 후보를 먼저 지정해주세요.');
  }
  if (prepared.length > 12) {
    throw new DomainError('UNPROCESSABLE', '후보는 12개까지 확정할 수 있습니다.');
  }

  const epoch = Math.max(campaign.voting_epoch, 1);
  const digest = await preparedDigest(prepared);
  if (expectedPreparedDigest.length > 0 && expectedPreparedDigest !== digest) {
    throw new DomainError(
      'CONFLICT',
      '목록을 확인하는 사이에 후보 지정이 바뀌었습니다. 목록을 다시 확인한 뒤 확정해주세요.',
    );
  }
  const now = Date.now();
  const guardId = newId();

  const existing = await env.DB.prepare(
    `SELECT id, status FROM candidate_sets WHERE campaign_id = ? AND epoch = ?`,
  )
    .bind(campaign.id, epoch)
    .first<{ id: string; status: string }>();

  const statements: D1PreparedStatement[] = [];
  /*
   * 확정 직전에 후보 지정이 바뀌지 않았는지 같은 batch 안에서 다시 본다.
   * 위 지문 비교는 batch 바깥이라 그 사이에 바뀔 수 있다.
   */
  statements.push(
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN
         (SELECT COUNT(*) FROM submissions WHERE campaign_id = ? AND status = 'CANDIDATE') = ?
       THEN 1 ELSE 0 END)`,
    ).bind(guardId, campaign.id, prepared.length),
  );
  let setId: string;

  if (existing === null) {
    setId = newId();
    statements.push(
      env.DB.prepare(
        `INSERT INTO candidate_sets(id, campaign_id, epoch, revision, status, rules_json, created_by)
         VALUES (?, ?, ?, 1, 'DRAFT', '{}', ?)`,
      ).bind(setId, campaign.id, epoch, admin.id),
      env.DB.prepare(`UPDATE campaigns SET voting_epoch = ?, updated_at = ? WHERE id = ?`).bind(epoch, now, campaign.id),
    );
  } else if (existing.status === 'FROZEN') {
    // 이미 확정된 목록을 다시 확정한다. 초안으로 되돌린 뒤 새 내용으로 채운다.
    setId = existing.id;
    statements.push(
      env.DB.prepare(`UPDATE candidate_sets SET status = 'DRAFT', digest = NULL, frozen_at = NULL WHERE id = ?`).bind(
        setId,
      ),
    );
  } else {
    setId = existing.id;
  }

  statements.push(env.DB.prepare(`DELETE FROM candidates WHERE set_id = ?`).bind(setId));
  prepared.forEach((entry, index) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO candidates(id, set_id, campaign_id, epoch, source_submission_id, public_message, public_number, display_order, rights_confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).bind(newId(), setId, campaign.id, epoch, entry.submissionId, entry.message, index + 1, index),
    );
  });

  statements.push(
    env.DB.prepare(`UPDATE candidate_sets SET status = 'FROZEN', digest = ?, frozen_at = ? WHERE id = ?`).bind(
      digest,
      now,
      setId,
    ),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'SHORTLIST_CONFIRMED',
        targetType: 'candidate_set',
        targetId: setId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { count: prepared.length },
      },
      now,
    ),
  );

  statements.push(env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError(
        'CONFLICT',
        '목록을 확인하는 사이에 후보 지정이 바뀌었습니다. 목록을 다시 확인한 뒤 확정해주세요.',
      );
    }
    if (text.includes('SET_FROZEN')) {
      throw new DomainError('CONFLICT', '확정된 후보를 바꿀 수 없습니다. 화면을 새로고침해주세요.');
    }
    if (text.includes('FREEZE_GATE')) throw new DomainError('CONFLICT', '후보 확정 조건을 만족하지 않습니다.');
    throw error;
  }

  return getShortlist(env, admin, campaignSlug);
}

/** 현재 캠페인의 최신 후보 묶음. 다른 모듈이 참조한다. */
export async function findCurrentSet(
  env: DataEnv,
  campaignId: string,
): Promise<{ id: string; epoch: number; status: string } | null> {
  return env.DB.prepare(
    `SELECT id, epoch, status FROM candidate_sets WHERE campaign_id = ? ORDER BY epoch DESC LIMIT 1`,
  )
    .bind(campaignId)
    .first<{ id: string; epoch: number; status: string }>();
}
