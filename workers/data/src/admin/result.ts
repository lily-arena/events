import { DomainError } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';
import { findCurrentSet } from './shortlist.js';

/**
 * 최종 문구 선정.
 * 담당자가 확정된 투표 후보 중 하나를 직접 고른다.
 * 심사 점수·가중치·동점 계산·선정 근거 입력은 쓰지 않는다. 최다 득표가 아니어도 고를 수 있다.
 */

export interface CandidateTally {
  readonly candidateId: string;
  readonly number: number;
  readonly message: string;
  readonly votes: number;
  /** 동률이면 같은 순위를 주고 다음 순위를 건너뛴다(1, 1, 3). */
  readonly rank: number;
}

export interface VoteRanking {
  readonly rows: readonly CandidateTally[];
  readonly received: number;
  readonly included: number;
  readonly excluded: number;
  readonly needsReview: number;
  readonly countedAt: number;
  readonly votingOpen: boolean;
}

const EFFECTIVE_STATE = `
  COALESCE((SELECT d.verdict FROM vote_decisions d WHERE d.vote_id = v.id ORDER BY d.version DESC LIMIT 1),
           v.initial_review_state)`;

/** 집계 포함 득표수 내림차순. 0표 후보도 포함한다. */
export async function getVoteRanking(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<VoteRanking> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const set = await findCurrentSet(env, campaign.id);
  const now = Date.now();

  if (set === null) {
    return { rows: [], received: 0, included: 0, excluded: 0, needsReview: 0, countedAt: now, votingOpen: false };
  }

  const rows = await env.DB.prepare(
    `SELECT c.id, c.public_number, c.public_message, c.display_order,
            (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = c.id AND ${EFFECTIVE_STATE} = 'INCLUDED') AS votes
       FROM candidates c WHERE c.set_id = ?
      ORDER BY votes DESC, c.display_order`,
  )
    .bind(set.id)
    .all<{ id: string; public_number: number; public_message: string; display_order: number; votes: number }>();

  // 동률은 같은 순위, 다음 순위는 건너뛴다.
  let rank = 0;
  let previousVotes: number | null = null;
  const ranked = rows.results.map((row, index) => {
    if (previousVotes === null || row.votes !== previousVotes) {
      rank = index + 1;
      previousVotes = row.votes;
    }
    return {
      candidateId: row.id,
      number: row.public_number,
      message: row.public_message,
      votes: row.votes,
      rank,
    };
  });

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS received,
            SUM(CASE WHEN ${EFFECTIVE_STATE} = 'INCLUDED' THEN 1 ELSE 0 END) AS included,
            SUM(CASE WHEN ${EFFECTIVE_STATE} = 'EXCLUDED' THEN 1 ELSE 0 END) AS excluded,
            SUM(CASE WHEN ${EFFECTIVE_STATE} = 'PENDING' THEN 1 ELSE 0 END) AS needs_review
       FROM votes v WHERE v.campaign_id = ? AND v.epoch = ?`,
  )
    .bind(campaign.id, campaign.voting_epoch)
    .first<{ received: number; included: number | null; excluded: number | null; needs_review: number | null }>();

  return {
    rows: ranked,
    received: totals?.received ?? 0,
    included: totals?.included ?? 0,
    excluded: totals?.excluded ?? 0,
    needsReview: totals?.needs_review ?? 0,
    countedAt: now,
    votingOpen: campaign.state === 'VOTING_OPEN',
  };
}

export interface FinalSelection {
  readonly resultId: string;
  readonly candidateId: string;
  readonly message: string;
  readonly selectedAt: number;
  readonly published: boolean;
}

export async function getFinalSelection(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<FinalSelection | null> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const row = await env.DB.prepare(
    `SELECT r.id, r.winner_candidate_id, r.selected_at, r.status, c.public_message
       FROM result_versions r JOIN candidates c ON c.id = r.winner_candidate_id
      WHERE r.campaign_id = ? AND r.status IN ('DRAFT','APPROVED','PUBLISHED')
      ORDER BY r.version DESC LIMIT 1`,
  )
    .bind(campaign.id)
    .first<{
      id: string;
      winner_candidate_id: string;
      selected_at: number | null;
      status: string;
      public_message: string;
    }>();
  if (row === null) return null;
  return {
    resultId: row.id,
    candidateId: row.winner_candidate_id,
    message: row.public_message,
    selectedAt: row.selected_at ?? 0,
    published: row.status === 'PUBLISHED',
  };
}

/**
 * 최종 문구를 확정한다.
 * 이미 공개된 뒤에 바꾸면 공개 중인 결과도 같은 작업에서 함께 바뀐다. 이전 이력은 남긴다.
 */
/**
 * 최종 문구를 확정한다.
 *
 * `expectedCurrentResultId`는 운영자 화면이 마지막으로 본 확정 문구의 id다(없으면 빈 문자열).
 * 다른 창이나 중복 클릭으로 그 사이에 다른 문구가 확정됐으면 덮어쓰지 않고 409로 알린다.
 * 새 version 번호는 batch 안에서 계산해 동시 확정이 같은 번호를 쓰지 않게 한다.
 */
export async function confirmFinalMessage(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  candidateId: string,
  expectedCurrentResultId: string,
  requestId: string,
): Promise<FinalSelection> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const set = await findCurrentSet(env, campaign.id);
  if (set === null || set.status !== 'FROZEN') {
    throw new DomainError('CONFLICT', '확정된 투표 후보가 없습니다. 숏리스트에서 후보를 먼저 확정해주세요.');
  }

  const candidate = await env.DB.prepare(
    `SELECT id, public_message FROM candidates WHERE id = ? AND set_id = ?`,
  )
    .bind(candidateId, set.id)
    .first<{ id: string; public_message: string }>();
  if (candidate === null) {
    throw new DomainError('UNPROCESSABLE', '이번 투표 후보 중에서 선택해주세요.');
  }

  const now = Date.now();
  const current = await env.DB.prepare(
    `SELECT id, status FROM result_versions WHERE campaign_id = ? ORDER BY version DESC LIMIT 1`,
  )
    .bind(campaign.id)
    .first<{ id: string; status: string }>();
  const wasPublished = current?.status === 'PUBLISHED';
  const currentId = current?.id ?? '';

  if (expectedCurrentResultId !== currentId) {
    throw new DomainError(
      'CONFLICT',
      '그 사이에 최종 문구가 바뀌었습니다. 화면을 새로고침한 뒤 다시 선택해주세요.',
    );
  }

  const id = newId();
  const guardId = newId();

  const statements: D1PreparedStatement[] = [];
  /*
   * 화면이 본 확정 문구가 아직 최신인지 같은 batch 안에서 다시 본다.
   * 중복 클릭과 다른 창의 동시 확정을 여기서 되돌린다.
   */
  statements.push(
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN
         COALESCE((SELECT id FROM result_versions WHERE campaign_id = ? ORDER BY version DESC LIMIT 1), '') = ?
       THEN 1 ELSE 0 END)`,
    ).bind(guardId, campaign.id, expectedCurrentResultId),
  );
  // 이전 선택은 이력으로 남긴다.
  if (current !== undefined && current !== null) {
    statements.push(
      env.DB.prepare(`UPDATE result_versions SET status = 'SUPERSEDED' WHERE id = ?`).bind(current.id),
    );
  }
  statements.push(
    env.DB.prepare(
      // version은 batch 안에서 계산한다. 밖에서 읽어 쓰면 동시 확정이 같은 번호를 받는다.
      `INSERT INTO result_versions(id, campaign_id, epoch, version, set_id, winner_candidate_id,
                                   status, maker_id, created_at, selection_mode, selected_by, selected_at)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM result_versions WHERE campaign_id = ?),
               ?, ?, ?, ?, ?, 'MANUAL', ?, ?)`,
    ).bind(
      id,
      campaign.id,
      set.epoch,
      campaign.id,
      set.id,
      candidateId,
      // 이미 공개 중이었다면 새 선택도 곧바로 공개 상태가 된다.
      wasPublished ? 'PUBLISHED' : 'DRAFT',
      admin.id,
      now,
      admin.id,
      now,
    ),
  );
  if (wasPublished) {
    statements.push(env.DB.prepare(`UPDATE result_versions SET published_at = ? WHERE id = ?`).bind(now, id));
  }
  statements.push(
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'FINAL_MESSAGE_CONFIRMED',
        targetType: 'result_version',
        targetId: id,
        outcome: 'SUCCESS',
        requestId,
        metadata: { candidateId, replacedPublished: wasPublished },
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
        '그 사이에 최종 문구가 바뀌었습니다. 화면을 새로고침한 뒤 다시 선택해주세요.',
      );
    }
    throw error;
  }
  return {
    resultId: id,
    candidateId,
    message: candidate.public_message,
    selectedAt: now,
    published: wasPublished,
  };
}

export interface MediaInput {
  readonly assetPath: string;
  readonly alt: string;
  readonly caption: string;
  readonly displayOrder: number;
}

const ALLOWED_ASSET_PREFIX = '/media/approved/';

/** 결과 화면 사진. 승인된 자산 경로만 쓴다. */
export async function putResultMedia(
  env: DataEnv,
  admin: AdminIdentity,
  resultId: string,
  media: readonly MediaInput[],
  requestId: string,
): Promise<{ count: number }> {
  requireRole(admin);
  for (const item of media) {
    if (!item.assetPath.startsWith(ALLOWED_ASSET_PREFIX)) {
      throw new DomainError('UNPROCESSABLE', '승인된 자산 경로만 사용할 수 있습니다.');
    }
    if (item.alt.trim().length === 0) throw new DomainError('UNPROCESSABLE', '대체 텍스트가 필요합니다.');
  }
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM result_media WHERE result_id = ?`).bind(resultId),
  ];
  for (const item of media) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO result_media(id, result_id, asset_path, alt_text, caption, display_order, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), resultId, item.assetPath, item.alt.trim(), item.caption, item.displayOrder, admin.id),
    );
  }
  statements.push(
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'RESULT_MEDIA_UPDATED',
        targetType: 'result_version',
        targetId: resultId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { count: media.length },
      },
      now,
    ),
  );
  await env.DB.batch(statements);
  return { count: media.length };
}
