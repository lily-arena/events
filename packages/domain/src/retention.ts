import { DomainError } from './errors.js';
import type { ContentBlock } from './dto.js';
export const PII_RETENTION_FIELD = 'pii_retention_days';
// Preserve the existing duration until the operator sets the campaign's actual limit.
export const EXISTING_PII_RETENTION_DAYS = 180;
export function parseRetentionDays(text: string): number {
  const days = Number(text);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new DomainError('UNPROCESSABLE', '개인정보 보유기간은 1~3650일 사이의 정수로 입력해주세요.');
  }
  return days;
}
export function retentionDays(blocks: readonly ContentBlock[]): number {
  const value = blocks.find((b) => b.key === PII_RETENTION_FIELD)?.text;
  return value === undefined ? EXISTING_PII_RETENTION_DAYS : parseRetentionDays(value);
}
