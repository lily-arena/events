import { DomainError, type FieldError } from './errors.js';

/**
 * 응모자 정보 검증. 필드 삭제·추가는 사용자 동의 없이 하지 않는다.
 * 전화번호 정규화는 국제표준 형식 정리이며 번호 소유권 확인이 아니다.
 */

export const CONTACT_ERRORS = {
  nameRequired: '이름을 입력해주세요.',
  nameTooLong: '이름은 50자 이내로 입력해주세요.',
  phoneRequired: '연락처를 입력해주세요.',
  phoneInvalid: '잘못된 형식입니다.',
  emailRequired: '이메일을 입력해주세요.',
  emailInvalid: '잘못된 형식입니다.',
} as const;

/** 국내 거주자 대상이므로 국가코드 없이 0으로 시작하는 번호는 KR(+82)로 해석한다. */
const KR_COUNTRY_CODE = '82';
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function normalizePhone(raw: string): string | null {
  const compact = raw.normalize('NFKC').replace(/[\s()\-.]/gu, '');
  if (!/^\+?\d+$/u.test(compact)) return null;
  if (compact.startsWith('+')) {
    const digits = compact.slice(1);
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (compact.startsWith('0')) {
    const national = compact.slice(1);
    if (national.length < 8 || national.length > 11) return null;
    return `+${KR_COUNTRY_CODE}${national}`;
  }
  if (compact.length < 8 || compact.length > 15) return null;
  return `+${compact}`;
}

export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim();
}

export interface ContactCheck {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
}

export function checkContact(input: { name: string; phone: string; email: string }): ContactCheck {
  const fieldErrors: FieldError[] = [];

  const name = normalizeName(input.name);
  if (name.length === 0) fieldErrors.push({ field: 'name', message: CONTACT_ERRORS.nameRequired });
  else if (name.length > 50) fieldErrors.push({ field: 'name', message: CONTACT_ERRORS.nameTooLong });

  const rawPhone = input.phone.trim();
  let phone = '';
  if (rawPhone.length === 0) fieldErrors.push({ field: 'phone', message: CONTACT_ERRORS.phoneRequired });
  else {
    const normalized = normalizePhone(rawPhone);
    if (normalized === null || !/^\+82(?:10\d{8}|2\d{7,8}|(?:[3-6][1-5]|70)\d{7,8})$/u.test(normalized)) fieldErrors.push({ field: 'phone', message: CONTACT_ERRORS.phoneInvalid });
    else phone = normalized;
  }

  const email = normalizeEmail(input.email);
  if (email.length === 0) fieldErrors.push({ field: 'email', message: CONTACT_ERRORS.emailRequired });
  else if (email.length > 254 || !EMAIL_RE.test(email))
    fieldErrors.push({ field: 'email', message: CONTACT_ERRORS.emailInvalid });

  if (fieldErrors.length > 0) {
    throw new DomainError('UNPROCESSABLE', '입력값을 확인해주세요.', fieldErrors);
  }
  return { name, phone, email };
}
