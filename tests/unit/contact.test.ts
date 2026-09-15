import { describe, expect, it } from 'vitest';
import { DomainError, checkContact, normalizePhone } from '@first-seat/domain';

describe('응모자 정보 검증', () => {
  it('국내 번호를 국제표준으로 정규화한다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('+821012345678');
    expect(normalizePhone('01012345678')).toBe('+821012345678');
    expect(normalizePhone('+82 10 1234 5678')).toBe('+821012345678');
    // E.164는 국가코드 뒤 국내 접두 0을 제거한다.
    expect(normalizePhone('02-123-4567')).toBe('+8221234567');
  });

  it('형식이 아니면 null', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('세 필드를 함께 검증하고 오류를 모은다', () => {
    try {
      checkContact({ name: '', phone: 'abc', email: 'not-an-email' });
      expect.unreachable();
    } catch (error) {
      const fields = (error as DomainError).fieldErrors.map((f) => f.field);
      expect(fields).toEqual(['name', 'phone', 'email']);
    }
  });

  it('정상 입력을 정규화해 돌려준다', () => {
    const result = checkContact({ name: ' 홍  길동 ', phone: '010-1234-5678', email: ' Test@Example.com ' });
    expect(result.name).toBe('홍 길동');
    expect(result.phone).toBe('+821012345678');
    expect(result.email).toBe('Test@Example.com');
  });

  it('이름 50자 초과를 거절한다', () => {
    expect(() => checkContact({ name: '가'.repeat(51), phone: '01012345678', email: 'a@b.com' })).toThrow(
      DomainError,
    );
  });
});

it('rejects malformed domestic numbers and email with the requested inline message', () => {
  for (const phone of ['0101234567', '010123456789', '010abc12345', '1234567890']) {
    try { checkContact({name:'테스트', phone, email:'user@example.com'}); expect.unreachable(); }
    catch (e) { expect((e as DomainError).fieldErrors).toContainEqual({field:'phone',message:'잘못된 형식입니다.'}); }
  }
  expect(() => checkContact({name:'테스트',phone:'01012345678',email:'user@example'})).toThrow(DomainError);
});
