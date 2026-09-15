import { DomainError } from './errors.js';

/**
 * 문구 정규화·검증. Public/Data가 같은 helper를 공유하며 최종 grapheme_count는 서버가 재계산한다.
 * 사용자 브라우저가 보낸 글자 수를 신뢰하지 않는다.
 */

const SEGMENTER = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 줄바꿈·탭을 포함한 제어문자. 좌석 각인 한 문장이므로 개행을 허용하지 않는다. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/u;

export function normalizeMessage(raw: string): string {
  return raw.normalize('NFC').trim();
}

export function countGraphemes(value: string): number {
  let n = 0;
  for (const _segment of SEGMENTER.segment(value)) n += 1;
  return n;
}

export interface MessageCheck {
  readonly normalized: string;
  readonly graphemeCount: number;
}

export const MESSAGE_ERRORS = {
  empty: '문구를 입력해주세요.',
  tooLong: (max: number) => `최대 ${max}자까지 입력할 수 있습니다.`,
  control: '줄바꿈이나 특수 제어문자는 사용할 수 없습니다.',
} as const;

/** 유효하면 정규화 결과를, 아니면 field 오류를 담은 DomainError를 던진다. */
export function checkMessage(raw: string, maxLength: number): MessageCheck {
  const normalized = normalizeMessage(raw);
  if (normalized.length === 0) {
    throw new DomainError('UNPROCESSABLE', MESSAGE_ERRORS.empty, [
      { field: 'message', message: MESSAGE_ERRORS.empty },
    ]);
  }
  if (CONTROL_CHARS.test(normalized)) {
    throw new DomainError('UNPROCESSABLE', MESSAGE_ERRORS.control, [
      { field: 'message', message: MESSAGE_ERRORS.control },
    ]);
  }
  const graphemeCount = countGraphemes(normalized);
  if (graphemeCount > maxLength) {
    const message = MESSAGE_ERRORS.tooLong(maxLength);
    throw new DomainError('UNPROCESSABLE', message, [{ field: 'message', message }]);
  }
  return { normalized, graphemeCount };
}
