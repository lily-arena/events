import { describe, expect, it } from 'vitest';
import { DomainError, parseSubmissionInput } from '@first-seat/domain';

const valid = {
  message: '테스트 문구',
  name: '홍길동',
  phone: '010-1234-5678',
  email: 'test@example.com',
  configRevision: 1,
  contentVersionId: '11111111-1111-4111-8111-111111111111',
  consents: [{ policyId: '22222222-2222-4222-8222-222222222222', accepted: true as const }],
  turnstileToken: 'mock-submission',
};

describe('SubmissionInput strict parser', () => {
  it('정상 입력을 통과시킨다', () => {
    expect(parseSubmissionInput(valid).message).toBe('테스트 문구');
  });

  it('unknown field를 거절한다', () => {
    expect(() => parseSubmissionInput({ ...valid, nickname: 'x' })).toThrow(DomainError);
  });

  it('필수 field 누락을 거절한다', () => {
    const { email, ...withoutEmail } = valid;
    void email;
    expect(() => parseSubmissionInput(withoutEmail)).toThrow(DomainError);
  });

  it('accepted가 true가 아니면 거절한다', () => {
    expect(() =>
      parseSubmissionInput({ ...valid, consents: [{ policyId: 'x', accepted: false }] }),
    ).toThrow(DomainError);
  });

  it('배열·null·문자열 body를 거절한다', () => {
    expect(() => parseSubmissionInput([])).toThrow(DomainError);
    expect(() => parseSubmissionInput(null)).toThrow(DomainError);
    expect(() => parseSubmissionInput('x')).toThrow(DomainError);
  });
});
