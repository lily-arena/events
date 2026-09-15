import { DomainError, type Campaign, type Policy } from '@first-seat/domain';
import { toPublicContent, type ContentBody, type ContentPage } from '@first-seat/content';
import type { DataEnv } from './env.js';
import type { CampaignRow, PolicyRow, PublishedContentRow } from './rows.js';

const CAMPAIGN_COLUMNS =
  'id, slug, state, paused, revision, max_message_length, submission_start, submission_end, voting_start, voting_end, voting_epoch, launch_approved';

export async function loadCampaign(env: DataEnv, slug: string): Promise<CampaignRow> {
  const row = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE slug = ?`)
    .bind(slug)
    .first<CampaignRow>();
  if (row === null) throw new DomainError('NOT_FOUND', '캠페인을 찾을 수 없습니다.');
  return row;
}

/** 현재 state에서 Public이 볼 수 있는 페이지. 직접 요청한 page도 이 표로 검사한다. */
export function pageForState(row: CampaignRow, now: number): ContentPage {
  // 일시 중단 중이면 어느 단계든 공통 안내 화면을 쓴다.
  if (row.paused === 1) return 'WAITING';
  switch (row.state) {
    case 'SUBMISSION_OPEN': {
      const start = row.submission_start;
      const end = row.submission_end;
      // 일정을 비워두면 수동으로 전환할 때까지 접수한다.
      // 시작 시각이 있는데 아직 이르거나, 마감 시각이 있는데 지났을 때만 대기 화면으로 간다.
      // packages/domain의 resolvePublicView와 같은 규칙이다.
      if (start !== null && now < start) return 'WAITING';
      if (end !== null && now >= end) return 'WAITING';
      return 'SUBMISSION';
    }
    case 'VOTING_OPEN':
      return 'VOTING';
    case 'RESULT_PUBLISHED':
    // 운영을 종료해도 공개된 결과는 그대로 둔다.
    case 'ARCHIVED':
      return 'RESULT';
    default:
      return 'WAITING';
  }
}

/** 부속 화면 접근 허용. /submitted는 접수가 열려 있을 때만 의미가 있다. */
export function isPageAllowed(page: ContentPage, current: ContentPage): boolean {
  if (page === current) return true;
  if (page === 'SUBMITTED') return current === 'SUBMISSION';
  if (page === 'VOTED') return current === 'VOTING';
  return false;
}

export async function loadPublishedContent(
  env: DataEnv,
  campaignId: string,
  page: ContentPage,
): Promise<PublishedContentRow> {
  const row = await env.DB.prepare(
    `SELECT p.content_version_id, p.page, p.locale, v.body_json, v.version
       FROM content_publications p
       JOIN content_versions v ON v.id = p.content_version_id
      WHERE p.campaign_id = ? AND p.page = ? AND p.locale = 'ko'`,
  )
    .bind(campaignId, page)
    .first<PublishedContentRow>();
  if (row === null) throw new DomainError('UNAVAILABLE', '게시된 콘텐츠가 없습니다.');
  return row;
}

export async function loadPolicies(env: DataEnv, campaignId: string): Promise<Policy[]> {
  const result = await env.DB.prepare(
    `SELECT d.id, d.kind, d.version, d.body, cp.required
       FROM campaign_policies cp
       JOIN policy_documents d ON d.id = cp.policy_id
      WHERE cp.campaign_id = ?
      ORDER BY cp.kind`,
  )
    .bind(campaignId)
    .all<PolicyRow>();
  return result.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    version: row.version,
    body: row.body,
    required: row.required === 1,
  }));
}

export async function buildCampaignDto(
  env: DataEnv,
  slug: string,
  requestedPage: ContentPage | null,
): Promise<Campaign> {
  const row = await loadCampaign(env, slug);
  const now = Date.now();
  const currentPage = pageForState(row, now);
  const page = requestedPage ?? currentPage;
  if (!isPageAllowed(page, currentPage)) {
    throw new DomainError('CONFLICT', '현재 단계에서 볼 수 없는 화면입니다.');
  }

  const content = await loadPublishedContent(env, row.id, page);
  const body = JSON.parse(content.body_json) as ContentBody;
  const policies = await loadPolicies(env, row.id);

  return {
    id: row.id,
    state: row.state,
    paused: row.paused === 1,
    revision: row.revision,
    maxMessageLength: row.max_message_length,
    submissionStart: row.submission_start,
    submissionEnd: row.submission_end,
    votingStart: row.voting_start,
    votingEnd: row.voting_end,
    serverTime: now,
    content: toPublicContent(content.content_version_id, page, body, {
      maxMessageLength: row.max_message_length,
    }),
    policies,
    // 실제 값은 Public Worker가 응답 직전에 채운다. Data는 비밀·공개 키를 갖지 않는다.
    turnstileSiteKey: '',
  };
}
