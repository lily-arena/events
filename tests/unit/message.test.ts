import { describe, expect, it } from 'vitest';
import { DomainError, checkMessage, countGraphemes, normalizeMessage } from '@first-seat/domain';

describe('문구 검증', () => {
  it('NFC 정규화와 앞뒤 공백 제거', () => {
    expect(normalizeMessage('  가나다  ')).toBe('가나다');
    // 결합형 한글을 완성형으로 정규화한다.
    expect(normalizeMessage('가')).toBe('가');
  });

  it('grapheme 단위로 센다', () => {
    expect(countGraphemes('가나다')).toBe(3);
    expect(countGraphemes('👨‍👩‍👧')).toBe(1);
    expect(countGraphemes('á')).toBe(1);
  });

  it('30자는 허용하고 31자는 거절한다', () => {
    expect(checkMessage('가'.repeat(30), 30).graphemeCount).toBe(30);
    expect(() => checkMessage('가'.repeat(31), 30)).toThrow(DomainError);
  });

  it('공백만 있으면 거절한다', () => {
    expect(() => checkMessage('   ', 30)).toThrow(DomainError);
  });

  it('줄바꿈·제어문자를 거절한다', () => {
    expect(() => checkMessage('첫 줄\n둘째 줄', 30)).toThrow(DomainError);
    expect(() => checkMessage('탭\t포함', 30)).toThrow(DomainError);
  });

  it('내부 공백과 문장부호는 허용한다', () => {
    expect(checkMessage('무대보다, 먼저 도착한 마음!', 30).graphemeCount).toBe(16);
  });

  it('오류에 field 정보를 담는다', () => {
    try {
      checkMessage('가'.repeat(31), 30);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fieldErrors[0]?.field).toBe('message');
      expect((error as DomainError).status).toBe(422);
    }
  });
});
