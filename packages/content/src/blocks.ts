import type { ContentBlock, ContentBlockType } from '@first-seat/domain';

/**
 * typed block CMS. 자유 HTML·script·iframe·layout editor는 제공하지 않는다.
 * 필수 block을 삭제하거나 순서를 바꾸는 편집은 서버가 거절한다.
 */

export type ContentPage = 'SUBMISSION' | 'SUBMITTED' | 'VOTING' | 'VOTED' | 'WAITING' | 'RESULT';

export interface ContentBody {
  readonly blocks: readonly ContentBlock[];
  readonly internalNotes?: string;
}

/** 페이지별 필수 block key와 순서. 사용자가 확정한 화면 순서를 그대로 강제한다. */
export const REQUIRED_BLOCKS: Readonly<Record<ContentPage, readonly string[]>> = {
  SUBMISSION: [
    'hero',
    'intro',
    'message_label',
    'message_helper',
    'exclusion_heading',
    'exclusions',
    'entrant_heading',
    'entrant_helper',
    'privacy_label',
    'license_label',
    'notices_heading',
    'notices',
    'submit',
  ],
  SUBMITTED: ['hero', 'headline', 'lead', 'back'],
  VOTING: ['hero', 'intro', 'vote_submit', 'notices_heading', 'notices'],
  // 투표는 한 번뿐이라 돌아갈 화면이 없다. 이동 버튼을 두지 않는다.
  VOTED: ['hero', 'headline', 'lead'],
  /*
   * 대기·중단 화면. 상황마다 다른 문구를 운영자가 직접 고칠 수 있게 항목을 나눈다.
   * intro는 상황별 문구가 없을 때 쓰는 기본 안내다.
   */
  WAITING: [
    'hero',
    'intro',
    'paused_headline',
    'paused_body',
    'waiting_submission_headline',
    'waiting_submission_body',
    'submission_closed_headline',
    'submission_closed_body',
    'waiting_voting_headline',
    'waiting_voting_body',
    'voting_closed_headline',
    'voting_closed_body',
  ],
  RESULT: ['hero', 'intro'],
};

const TEXT_BLOCKS: readonly ContentBlockType[] = ['heading', 'label', 'helper', 'notice', 'button'];
const LIST_BLOCKS: readonly ContentBlockType[] = ['paragraphs', 'list'];

/** 편집 초안이 구조 계약을 지키는지 확인한다. 실패 사유 목록을 돌려준다. */
export function validateBody(page: ContentPage, body: ContentBody): string[] {
  const problems: string[] = [];
  const keys = body.blocks.map((b) => b.key);

  const required = REQUIRED_BLOCKS[page];
  for (const key of required) {
    if (!keys.includes(key)) problems.push(`필수 block 누락: ${key}`);
  }
  const presentRequired = keys.filter((k) => required.includes(k));
  const expectedOrder = required.filter((k) => keys.includes(k));
  if (presentRequired.join(',') !== expectedOrder.join(',')) {
    problems.push('필수 block 순서가 계약과 다릅니다.');
  }
  if (new Set(keys).size !== keys.length) problems.push('중복된 block key가 있습니다.');

  for (const block of body.blocks) {
    if (TEXT_BLOCKS.includes(block.type)) {
      if (typeof block.text !== 'string' || block.text.trim().length === 0) {
        problems.push(`${block.key}: text가 필요합니다.`);
      }
    } else if (LIST_BLOCKS.includes(block.type)) {
      if (!Array.isArray(block.items) || block.items.length === 0) {
        problems.push(`${block.key}: items가 필요합니다.`);
      }
    } else {
      problems.push(`${block.key}: 허용되지 않은 block type ${block.type}`);
    }
    const raw = [block.text ?? '', ...(block.items ?? [])].join('\n');
    if (/<[a-z/!]/iu.test(raw)) problems.push(`${block.key}: raw HTML은 허용하지 않습니다.`);
  }
  return problems;
}
