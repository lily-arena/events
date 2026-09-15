import type { Campaign, ErrorBody, SessionDto, SubmissionSuccess } from '@first-seat/domain';

/**
 * API client. PII·문구를 localStorage·URL·analytics에 저장하지 않는다.
 * csrfToken은 현재 탭 메모리에만 둔다.
 *
 * 브라우저는 언제나 이 화면 주소의 /api만 부른다.
 * 실제 처리는 Cloudflare에서 하지만 그 사이는 Vercel 서버가 중계하므로
 * 쿠키는 같은 출처 쿠키이고 회사 DNS에는 화면 주소만 추가하면 된다.
 */

/** 같은 출처 API 경로. 다른 호스트를 부르지 않는다. */
export function apiUrl(path: string): string {
  return path;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  // JSON이 아니면(프록시 오류 페이지 등) 파싱 예외로 원래 오류를 감추지 않는다.
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const body =
      data !== null && typeof data === 'object'
        ? (data as ErrorBody)
        : { code: 'UNAVAILABLE' as const, message: '잠시 후 다시 시도해주세요.', requestId: '' };
    throw new ApiError(response.status, body);
  }
  return data as T;
}

export async function fetchCampaign(page?: string): Promise<Campaign> {
  const query = page === undefined ? '' : `?page=${encodeURIComponent(page)}`;
  const response = await fetch(apiUrl(`/api/campaign${query}`), {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  return parse<Campaign>(response);
}

export async function startSession(): Promise<SessionDto> {
  const response = await fetch(apiUrl('/api/submission-session'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  return parse<SessionDto>(response);
}

export interface SubmitPayload {
  readonly message: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly configRevision: number;
  readonly contentVersionId: string;
  readonly consents: readonly { policyId: string; accepted: true }[];
  readonly turnstileToken: string;
}

export async function submitEntry(
  payload: SubmitPayload,
  csrfToken: string,
  idempotencyKey: string,
): Promise<SubmissionSuccess> {
  const response = await fetch(apiUrl('/api/submissions'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  return parse<SubmissionSuccess>(response);
}

export interface CandidateDto {
  readonly id: string;
  readonly number: number;
  readonly message: string;
}

export interface CandidatesDto {
  readonly epoch: number;
  readonly setId: string;
  readonly setRevision: number;
  readonly candidates: readonly CandidateDto[];
}

export interface VoteStatusDto {
  readonly epoch: number;
  readonly voted: boolean;
}

export interface ResultDto {
  readonly version: number;
  readonly winnerMessage: string;
  readonly publishedAt: number;
  readonly correctionNote: string | null;
  readonly media: readonly { assetPath: string; alt: string; caption: string }[];
}

export async function fetchCandidates(): Promise<CandidatesDto> {
  const response = await fetch(apiUrl('/api/candidates'), { credentials: 'same-origin' });
  return parse<CandidatesDto>(response);
}

export async function fetchVoteStatus(): Promise<VoteStatusDto> {
  const response = await fetch(apiUrl('/api/vote-status'), { credentials: 'same-origin' });
  return parse<VoteStatusDto>(response);
}

export async function fetchResult(): Promise<ResultDto> {
  const response = await fetch(apiUrl('/api/result'), { credentials: 'same-origin' });
  return parse<ResultDto>(response);
}

/** 투표 참여 token 발급. 발급용 action token을 쓰며 투표 제출과 다른 token이다. */
export async function startVoterSession(
  csrfToken: string,
  turnstileToken: string,
): Promise<{ epoch: number; expiresAt: number }> {
  const response = await fetch(apiUrl('/api/voter-session'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ turnstileToken }),
  });
  return parse<{ epoch: number; expiresAt: number }>(response);
}

export async function castVote(
  candidateId: string,
  setId: string,
  csrfToken: string,
  idempotencyKey: string,
  turnstileToken: string,
): Promise<{ status: string; redirect: string }> {
  const response = await fetch(apiUrl('/api/votes'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ candidateId, setId, turnstileToken }),
  });
  return parse<{ status: string; redirect: string }>(response);
}
