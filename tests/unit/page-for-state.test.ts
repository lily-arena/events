import { describe, expect, it } from 'vitest';
import { isPageAllowed, pageForState } from '../../workers/data/src/campaign.js';
import type { CampaignRow } from '../../workers/data/src/rows.js';

/**
 * 공개 화면 판정. 마감 일정을 미리 정하지 않는 운영 방식을 지원해야 한다.
 * packages/domain의 resolvePublicView와 같은 규칙을 따른다.
 */

const NOW = 1_800_000_000_000;

function row(over: Partial<CampaignRow>): CampaignRow {
  return {
    state: 'SUBMISSION_OPEN',
    submission_start: null,
    submission_end: null,
    paused: 0,
    ...over,
  } as CampaignRow;
}

describe('pageForState', () => {
  it('일정을 비워두면 접수 화면을 연다', () => {
    expect(pageForState(row({}), NOW)).toBe('SUBMISSION');
  });

  it('시작 시각이 아직 오지 않으면 대기 화면을 보여준다', () => {
    expect(pageForState(row({ submission_start: NOW + 1000 }), NOW)).toBe('WAITING');
  });

  it('시작 시각이 지났고 마감이 없으면 접수 화면을 연다', () => {
    expect(pageForState(row({ submission_start: NOW - 1000 }), NOW)).toBe('SUBMISSION');
  });

  it('마감 시각이 지나면 대기 화면으로 바뀐다', () => {
    expect(pageForState(row({ submission_end: NOW - 1 }), NOW)).toBe('WAITING');
  });

  it('마감 직전에는 접수 화면을 유지한다', () => {
    expect(pageForState(row({ submission_end: NOW + 1 }), NOW)).toBe('SUBMISSION');
  });

  it('투표 단계는 일정과 무관하게 투표 화면이다', () => {
    expect(pageForState(row({ state: 'VOTING_OPEN' }), NOW)).toBe('VOTING');
  });

  it('일시 중단 중에는 공통 안내 화면을 쓴다', () => {
    expect(pageForState(row({ paused: 1 }), NOW)).toBe('WAITING');
    expect(pageForState(row({ state: 'VOTING_OPEN', paused: 1 }), NOW)).toBe('WAITING');
  });

  it('운영을 종료해도 결과 화면을 유지한다', () => {
    expect(pageForState(row({ state: 'ARCHIVED' }), NOW)).toBe('RESULT');
  });
});

describe('isPageAllowed', () => {
  it('접수완료 화면은 접수 중일 때만 열린다', () => {
    expect(isPageAllowed('SUBMITTED', 'SUBMISSION')).toBe(true);
    expect(isPageAllowed('SUBMITTED', 'WAITING')).toBe(false);
  });

  it('투표완료 화면은 투표 중일 때만 열린다', () => {
    expect(isPageAllowed('VOTED', 'VOTING')).toBe(true);
    expect(isPageAllowed('VOTED', 'RESULT')).toBe(false);
  });
});
