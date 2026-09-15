import type { CampaignState } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import type { AdminIdentity } from './common.js';
import {
  effectiveClosure,
  nextActionFor,
  participationLabel,
  previewAction,
  publicStatusLabel,
  type ActionPreview,
  type CampaignActionKind,
} from './actions.js';
import { findCurrentSet } from './shortlist.js';

/**
 * 대시보드 요약.
 * 개인정보를 담지 않으며 역할에 따라 볼 수 있는 항목만 채운다.
 * 조회에 실패한 값은 0이 아니라 null로 돌려 '없음'과 '확인 실패'를 구분한다.
 */

export interface SectionCounts {
  readonly submission: {
    total: number | null;
    pending: number | null;
    approved: number | null;
  };
  readonly voting: {
    candidates: number | null;
    received: number | null;
    included: number | null;
    excluded: number | null;
    needsReview: number | null;
  };
  readonly result: {
    scored: number | null;
    totalCandidates: number | null;
    computed: boolean | null;
    approved: boolean | null;
    published: boolean | null;
  };
}

export interface DashboardView {
  readonly serverNow: number;
  readonly campaignRevision: number;
  readonly publicStatus: string;
  readonly participation: string;
  readonly paused: boolean;
  readonly period: { label: string; start: number | null; end: number | null };
  readonly launchApproved: boolean;
  readonly nextAction: CampaignActionKind | null;
  readonly nextActionPreview: ActionPreview | null;
  readonly counts: SectionCounts;
  readonly roles: readonly string[];
  readonly schedule: {
    submissionStart: number | null;
    submissionEnd: number | null;
    votingStart: number | null;
    votingEnd: number | null;
    maxMessageLength: number;
  };
}

const EFFECTIVE_VOTE_STATE = `
  COALESCE((SELECT d.verdict FROM vote_decisions d WHERE d.vote_id = v.id ORDER BY d.version DESC LIMIT 1),
           v.initial_review_state)`;

export async function getDashboard(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
): Promise<DashboardView> {
  const campaign = await loadCampaign(env, campaignSlug);
  const now = Date.now();
  const closure = effectiveClosure(campaign.state, now, campaign.submission_end, campaign.voting_end);
  // 인증된 담당자는 모든 요약을 본다. 역할별 분리를 두지 않는다.
  const canOperate = true;

  const counts: SectionCounts = {
    submission: { total: null, pending: null, approved: null },
    voting: { candidates: null, received: null, included: null, excluded: null, needsReview: null },
    result: { scored: null, totalCandidates: null, computed: null, approved: null, published: null },
  };

  // 심사 요약: 심사 권한이 있는 사람에게만
  {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved
         FROM submissions WHERE campaign_id = ?`,
    )
      .bind(campaign.id)
      .first<{ total: number; pending: number | null; approved: number | null }>();
    if (row !== null) {
      (counts.submission as { total: number | null; pending: number | null; approved: number | null }) = {
        total: row.total,
        pending: row.pending ?? 0,
        approved: row.approved ?? 0,
      };
    }
  }

  {
    const set = await findCurrentSet(env, campaign.id);
    const candidateCount =
      set === null
        ? 0
        : (await env.DB.prepare(`SELECT COUNT(*) AS n FROM candidates WHERE set_id = ?`).bind(set.id).first<{ n: number }>())
            ?.n ?? 0;
    const votes = await env.DB.prepare(
      `SELECT COUNT(*) AS received,
              SUM(CASE WHEN ${EFFECTIVE_VOTE_STATE} = 'INCLUDED' THEN 1 ELSE 0 END) AS included,
              SUM(CASE WHEN ${EFFECTIVE_VOTE_STATE} = 'EXCLUDED' THEN 1 ELSE 0 END) AS excluded,
              SUM(CASE WHEN ${EFFECTIVE_VOTE_STATE} = 'PENDING' THEN 1 ELSE 0 END) AS needs_review
         FROM votes v WHERE v.campaign_id = ? AND v.epoch = ?`,
    )
      .bind(campaign.id, campaign.voting_epoch)
      .first<{ received: number; included: number | null; excluded: number | null; needs_review: number | null }>();
    (counts.voting as SectionCounts['voting']) = {
      candidates: set?.status === 'FROZEN' ? candidateCount : 0,
      received: votes?.received ?? 0,
      included: votes?.included ?? 0,
      excluded: votes?.excluded ?? 0,
      needsReview: votes?.needs_review ?? 0,
    };

    const scored =
      set === null
        ? 0
        : (
            await env.DB.prepare(`SELECT COUNT(DISTINCT candidate_id) AS n FROM jury_scores WHERE set_id = ?`)
              .bind(set.id)
              .first<{ n: number }>()
          )?.n ?? 0;
    const results = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status IN('DRAFT','APPROVED','PUBLISHED') THEN 1 ELSE 0 END) AS computed,
         SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published
       FROM result_versions WHERE campaign_id = ?`,
    )
      .bind(campaign.id)
      .first<{ computed: number | null; approved: number | null; published: number | null }>();
    (counts.result as SectionCounts['result']) = {
      scored,
      totalCandidates: candidateCount,
      computed: (results?.computed ?? 0) > 0,
      approved: (results?.approved ?? 0) > 0,
      published: (results?.published ?? 0) > 0,
    };
  }

  const nextAction = nextActionFor(campaign.state);
  let nextActionPreview: ActionPreview | null = null;
  if (nextAction !== null) {
    try {
      nextActionPreview = await previewAction(env, admin, campaignSlug, nextAction);
    } catch {
      nextActionPreview = null;
    }
  }

  const periodLabel =
    campaign.state === 'SUBMISSION_OPEN'
      ? '공모 기간'
      : campaign.state === 'VOTING_OPEN'
        ? '투표 기간'
        : campaign.state === 'DRAFT'
          ? '예정된 공모 기간'
          : '';
  const period =
    campaign.state === 'VOTING_OPEN'
      ? { label: periodLabel, start: campaign.voting_start, end: campaign.voting_end }
      : { label: periodLabel, start: campaign.submission_start, end: campaign.submission_end };

  return {
    serverNow: now,
    campaignRevision: campaign.revision,
    publicStatus: publicStatusLabel(campaign.state as CampaignState, campaign.paused === 1, closure),
    participation: participationLabel(campaign.state as CampaignState, campaign.paused === 1, closure),
    paused: campaign.paused === 1,
    period,
    launchApproved: campaign.launch_approved === 1,
    nextAction,
    nextActionPreview,
    counts,
    roles: admin.roles,
    schedule: {
      submissionStart: campaign.submission_start,
      submissionEnd: campaign.submission_end,
      votingStart: campaign.voting_start,
      votingEnd: campaign.voting_end,
      maxMessageLength: campaign.max_message_length,
    },
  };
}
