import { describe, expect, it } from 'vitest';
import { canTransition, resolvePublicView } from '@first-seat/domain';

describe('캠페인 상태', () => {
  it('허용된 전이만 통과한다', () => {
    expect(canTransition('DRAFT', 'SUBMISSION_OPEN')).toBe(true);
    expect(canTransition('SUBMISSION_OPEN', 'DRAFT')).toBe(false);
    expect(canTransition('VOTING_OPEN', 'SUBMISSION_OPEN')).toBe(false);
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(false);
  });

  it('paused는 상태와 무관하게 중단 화면을 보여준다', () => {
    expect(
      resolvePublicView({
        state: 'SUBMISSION_OPEN',
        paused: true,
        serverTime: 100,
        submissionStart: 0,
        submissionEnd: 1000,
      }),
    ).toBe('PAUSED');
  });

  it('마감 시각 이후에는 접수 화면을 열지 않는다', () => {
    const base = { state: 'SUBMISSION_OPEN' as const, paused: false, submissionStart: 0, submissionEnd: 1000 };
    expect(resolvePublicView({ ...base, serverTime: 999 })).toBe('SUBMISSION');
    // [start, end) 규칙: 마감 시각 자체는 포함하지 않는다.
    expect(resolvePublicView({ ...base, serverTime: 1000 })).toBe('SUBMISSION_CLOSED');
    expect(resolvePublicView({ ...base, serverTime: -1 })).toBe('WAITING_SUBMISSION');
  });

  it('마감을 정하지 않으면 수동으로 종료할 때까지 접수한다', () => {
    // 운영자가 마감 일정을 비워 둘 수 있다. 이때는 계속 진행한다.
    expect(
      resolvePublicView({
        state: 'SUBMISSION_OPEN',
        paused: false,
        serverTime: 100,
        submissionStart: null,
        submissionEnd: null,
      }),
    ).toBe('SUBMISSION');
    expect(
      resolvePublicView({
        state: 'SUBMISSION_OPEN',
        paused: false,
        serverTime: 100,
        submissionStart: 0,
        submissionEnd: null,
      }),
    ).toBe('SUBMISSION');
  });

  it('시작 시각이 아직 오지 않으면 대기 화면', () => {
    expect(
      resolvePublicView({
        state: 'SUBMISSION_OPEN',
        paused: false,
        serverTime: 100,
        submissionStart: 200,
        submissionEnd: null,
      }),
    ).toBe('WAITING_SUBMISSION');
  });
});
