import { describe, expect, it } from 'vitest';
import {
  CONTENT_SEEDS,
  findUnresolvedPlaceholders,
  renderTemplate,
  seedFor,
  toPublicContent,
  validateBody,
} from '@first-seat/content';

describe('콘텐츠 계약', () => {
  it('공모 seed가 필수 block 계약을 만족한다', () => {
    const seed = seedFor('SUBMISSION');
    expect(seed).toBeDefined();
    expect(validateBody('SUBMISSION', seed!.body)).toEqual([]);
  });

  it('접수완료 seed의 이동 CTA는 돌아가기 하나다', () => {
    const seed = seedFor('SUBMITTED');
    expect(validateBody('SUBMITTED', seed!.body)).toEqual([]);
    const buttons = seed!.body.blocks.filter((b) => b.type === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.text).toBe('돌아가기');
  });

  it('필수 block을 지우면 실패한다', () => {
    const seed = seedFor('SUBMISSION')!;
    const broken = { blocks: seed.body.blocks.filter((b) => b.key !== 'notices') };
    expect(validateBody('SUBMISSION', broken)).toContain('필수 block 누락: notices');
  });

  it('raw HTML을 거절한다', () => {
    expect(
      validateBody('SUBMITTED', {
        blocks: [
          { key: 'hero', type: 'heading', text: 'FIRST SEAT' },
          { key: 'headline', type: 'heading', text: '<script>alert(1)</script>' },
          { key: 'lead', type: 'paragraphs', items: ['a'] },
          { key: 'back', type: 'button', text: '돌아가기' },
        ],
      }),
    ).toContain('headline: raw HTML은 허용하지 않습니다.');
  });

  it('whitelist 변수만 치환하고 미정값은 남긴다', () => {
    expect(renderTemplate('최대 {{maxMessageLength}}자', { maxMessageLength: 30 })).toBe('최대 30자');
    expect(renderTemplate('{{unknown_var}}', {})).toBe('{{unknown_var}}');
    expect(renderTemplate('{{voting_period_kst}}', {})).toBe('{{voting_period_kst}}');
  });

  it('Public DTO에 internalNotes를 넣지 않는다', () => {
    const seed = seedFor('SUBMISSION')!;
    const dto = toPublicContent('v1', 'SUBMISSION', seed.body, { maxMessageLength: 30 });
    expect(JSON.stringify(dto)).not.toContain('internalNotes');
    expect(findUnresolvedPlaceholders(dto.blocks)).toEqual([]);
  });

  it('사용자 원문 유의사항 9개를 유지한다', () => {
    const seed = seedFor('SUBMISSION')!;
    const notices = seed.body.blocks.find((b) => b.key === 'notices');
    expect(notices?.items).toHaveLength(9);
    expect(notices?.items?.[7]).toContain('국내 거주자만을 대상으로 합니다');
  });

  it('seed는 DRAFT 상태로 시작한다', () => {
    for (const seed of CONTENT_SEEDS) expect(seed.status).toBe('DRAFT');
  });
});
