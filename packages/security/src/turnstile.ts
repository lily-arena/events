/**
 * Turnstile 서버 Siteverify. 클라이언트 성공 callback을 신뢰하지 않는다.
 * action은 발급용/투표용을 구분하며 한 token을 두 API에 재사용하지 않는다.
 */

export type TurnstileAction = 'submission' | 'voter_session' | 'vote';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** challenge 발급 후 허용 시간. Turnstile token 자체 수명은 5분이다. */
const MAX_CHALLENGE_AGE_MS = 5 * 60 * 1000;

export interface TurnstileConfig {
  readonly mode: 'live' | 'mock';
  readonly secret: string;
  readonly allowedHostnames: readonly string[];
  readonly environment: string;
}

export interface TurnstileVerifyInput {
  readonly token: string;
  readonly action: TurnstileAction;
  readonly remoteIp: string | null;
  /** Siteverify 재시도 시 공급자 측 중복 처리를 막는 key */
  readonly idempotencyKey: string;
  readonly now: number;
}

export interface TurnstileResult {
  readonly ok: boolean;
  readonly reason?: string;
}

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  challenge_ts?: string;
  'error-codes'?: string[];
}

export async function verifyTurnstile(
  config: TurnstileConfig,
  input: TurnstileVerifyInput,
): Promise<TurnstileResult> {
  if (config.mode === 'mock') {
    // 개발용 mock은 production에서 켜지면 즉시 실패해야 한다.
    if (config.environment === 'production') {
      return { ok: false, reason: 'MOCK_IN_PRODUCTION' };
    }
    return input.token === `mock-${input.action}`
      ? { ok: true }
      : { ok: false, reason: 'MOCK_TOKEN_MISMATCH' };
  }

  const body = new FormData();
  body.append('secret', config.secret);
  body.append('response', input.token);
  if (input.remoteIp !== null) body.append('remoteip', input.remoteIp);
  body.append('idempotency_key', input.idempotencyKey);

  let payload: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    payload = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: 'SITEVERIFY_UNAVAILABLE' };
  }

  if (payload.success !== true) {
    return { ok: false, reason: (payload['error-codes'] ?? []).join(',') || 'CHALLENGE_FAILED' };
  }
  if (payload.action !== input.action) return { ok: false, reason: 'ACTION_MISMATCH' };
  if (payload.hostname === undefined || !config.allowedHostnames.includes(payload.hostname)) {
    return { ok: false, reason: 'HOSTNAME_MISMATCH' };
  }
  if (payload.challenge_ts !== undefined) {
    const issuedAt = Date.parse(payload.challenge_ts);
    if (Number.isNaN(issuedAt) || input.now - issuedAt > MAX_CHALLENGE_AGE_MS) {
      return { ok: false, reason: 'CHALLENGE_EXPIRED' };
    }
  }
  return { ok: true };
}
