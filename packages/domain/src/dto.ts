import { DomainError } from './errors.js';
import type { CampaignState } from './state.js';

/** api/openapi.json과 1:1로 맞춘 DTO. 변경 시 OpenAPI를 함께 고친다. */

export type ContentBlockType = 'heading' | 'paragraphs' | 'list' | 'label' | 'helper' | 'notice' | 'button';

export interface ContentBlock {
  readonly key: string;
  readonly type: ContentBlockType;
  readonly text?: string;
  readonly items?: readonly string[];
}

export interface PublicContent {
  readonly versionId: string;
  readonly page: string;
  readonly locale: 'ko';
  readonly blocks: readonly ContentBlock[];
}

export interface Policy {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly body: string;
  readonly required: boolean;
}

export interface Campaign {
  readonly id: string;
  readonly state: CampaignState;
  readonly paused: boolean;
  readonly revision: number;
  readonly maxMessageLength: number;
  readonly submissionStart: number | null;
  readonly submissionEnd: number | null;
  readonly votingStart: number | null;
  readonly votingEnd: number | null;
  readonly serverTime: number;
  readonly content: PublicContent;
  readonly policies: readonly Policy[];
  /**
   * 보안 확인(Turnstile) 공개 키.
   * 공개 값이며 비밀이 아니다. 서버는 이 키로 만든 token을 다시 검증한다.
   * 개발 모드에서는 mock으로 시작하는 값이 온다.
   */
  readonly turnstileSiteKey: string;
}

export interface SessionDto {
  readonly csrfToken: string;
  readonly expiresAt: number;
  readonly epoch: number;
}

export interface ConsentDto {
  readonly policyId: string;
  readonly accepted: true;
}

export interface SubmissionInput {
  readonly message: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly configRevision: number;
  readonly contentVersionId: string;
  readonly consents: readonly ConsentDto[];
  readonly turnstileToken: string;
}

export interface SubmissionSuccess {
  readonly status: 'accepted';
  readonly redirect: '/submitted';
  readonly requestId: string;
}

/** unknown field를 거절하는 strict parser. 클라이언트가 보낸 여분 키를 조용히 버리지 않는다. */
function requireObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new DomainError('BAD_REQUEST', `허용되지 않은 field: ${key}`);
    }
  }
  return record;
}

function asString(record: Record<string, unknown>, key: string, max: number): string {
  const raw = record[key];
  if (typeof raw !== 'string') throw new DomainError('BAD_REQUEST', `${key} 형식이 올바르지 않습니다.`);
  if (raw.length > max) throw new DomainError('BAD_REQUEST', `${key} 길이가 허용 범위를 넘었습니다.`);
  return raw;
}

function asPositiveInt(record: Record<string, unknown>, key: string): number {
  const raw = record[key];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new DomainError('BAD_REQUEST', `${key} 형식이 올바르지 않습니다.`);
  }
  return raw;
}

const SUBMISSION_KEYS = [
  'message',
  'name',
  'phone',
  'email',
  'configRevision',
  'contentVersionId',
  'consents',
  'turnstileToken',
] as const;

const CONSENT_KEYS = ['policyId', 'accepted'] as const;

export function parseSubmissionInput(value: unknown): SubmissionInput {
  const record = requireObject(value, SUBMISSION_KEYS);
  for (const key of SUBMISSION_KEYS) {
    if (!(key in record)) throw new DomainError('BAD_REQUEST', `${key}가 필요합니다.`);
  }
  const rawConsents = record['consents'];
  if (!Array.isArray(rawConsents)) throw new DomainError('BAD_REQUEST', 'consents 형식이 올바르지 않습니다.');
  const consents = rawConsents.map((item): ConsentDto => {
    const consent = requireObject(item, CONSENT_KEYS);
    if (consent['accepted'] !== true) {
      throw new DomainError('BAD_REQUEST', '동의 값이 올바르지 않습니다.');
    }
    return { policyId: asString(consent, 'policyId', 64), accepted: true };
  });

  return {
    // 길이 상한은 OpenAPI 계약값. 업무 규칙(30자)은 서버가 campaign 설정으로 다시 검사한다.
    message: asString(record, 'message', 400),
    name: asString(record, 'name', 50),
    phone: asString(record, 'phone', 32),
    email: asString(record, 'email', 254),
    configRevision: asPositiveInt(record, 'configRevision'),
    contentVersionId: asString(record, 'contentVersionId', 64),
    consents,
    turnstileToken: asString(record, 'turnstileToken', 2048),
  };
}
