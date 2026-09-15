import { DomainError } from '@first-seat/domain';
import type { DataEnv } from './env.js';
import { loadCampaign } from './campaign.js';

/**
 * 공개 결과. 게시된 result_versions의 선정값을 렌더링하며 콘텐츠 편집으로 바꾸지 않는다.
 * 응모자 이름·연락처는 넣지 않는다.
 * 선정 근거는 더 이상 공개하지 않는다. 과거 데이터는 남기되 전달하지 않는다.
 */

export interface PublicResultMedia {
  readonly assetPath: string;
  readonly alt: string;
  readonly caption: string;
}

export interface PublicResult {
  readonly version: number;
  readonly winnerMessage: string;
  readonly publishedAt: number;
  readonly correctionNote: string | null;
  readonly media: readonly PublicResultMedia[];
}

export async function getPublishedResult(env: DataEnv, campaignSlug: string): Promise<PublicResult> {
  const campaign = await loadCampaign(env, campaignSlug);
  if (campaign.state !== 'RESULT_PUBLISHED' && campaign.state !== 'ARCHIVED') {
    throw new DomainError('NOT_FOUND', '아직 공개된 결과가 없습니다.');
  }
  const row = await env.DB.prepare(
    `SELECT r.id, r.version, r.published_at, r.correction_note, c.public_message
       FROM result_versions r
       JOIN candidates c ON c.id = r.winner_candidate_id
      WHERE r.campaign_id = ? AND r.status = 'PUBLISHED'
      ORDER BY r.version DESC LIMIT 1`,
  )
    .bind(campaign.id)
    .first<{
      id: string;
      version: number;
      published_at: number | null;
      correction_note: string | null;
      public_message: string;
    }>();
  if (row === null) throw new DomainError('NOT_FOUND', '아직 공개된 결과가 없습니다.');

  const media = await env.DB.prepare(
    `SELECT asset_path, alt_text, caption FROM result_media WHERE result_id = ? ORDER BY display_order`,
  )
    .bind(row.id)
    .all<{ asset_path: string; alt_text: string; caption: string }>();

  return {
    version: row.version,
    winnerMessage: row.public_message,
    publishedAt: row.published_at ?? 0,
    correctionNote: row.correction_note,
    media: media.results.map((m) => ({ assetPath: m.asset_path, alt: m.alt_text, caption: m.caption })),
  };
}
