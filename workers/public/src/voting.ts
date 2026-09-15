import { DomainError } from '@first-seat/domain';
import {
  csrfTokenFor,
  hmacSha256Hex,
  keyHashOf,
  newSessionToken,
  requestHmacOf,
  sessionHash as computeSessionHash,
  verifyCsrf,
  verifyTurnstile,
} from '@first-seat/security';
import { allowedHostnames, allowedOrigins, type PublicEnv, type RpcResult } from './env.js';
import { cookieNames, readCookie, setCookie } from './cookies.js';
import { errorResponse, jsonResponse, readJsonBody } from './http.js';
import { isSameOriginRequest } from '@first-seat/security';

/**
 * 투표 경로. 발급용(voter_session)과 투표용(vote) action token을 구분하며
 * 한 token을 두 API에 재사용하지 않는다.
 */

const VOTER_COOKIE_TTL_SECONDS = 60 * 24 * 60 * 60;
const VOTED_COOKIE_TTL_SECONDS = 5 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new DomainError(result.code as never, result.message, result.fieldErrors);
}

/** 정밀 fingerprint를 만들지 않는다. 대략적인 클라이언트 구분만 남긴다. */
function coarseClientClass(request: Request): string {
  const ua = request.headers.get('User-Agent') ?? '';
  if (ua.length === 0) return 'unknown';
  if (/bot|crawler|spider|curl|wget|python|node-fetch/iu.test(ua)) return 'automated';
  if (/iphone|ipad|android|mobile/iu.test(ua)) return 'mobile';
  return 'desktop';
}

export async function handleVoterSession(
  request: Request,
  env: PublicEnv,
  requestId: string,
): Promise<Response> {
  if (!isSameOriginRequest(request, allowedOrigins(env))) {
    return errorResponse('CSRF_FAILED', '요청 출처를 확인할 수 없습니다.', requestId);
  }
  const names = cookieNames(env.ENVIRONMENT);
  const submitToken = readCookie(request, names.submit);
  if (submitToken === null) {
    return errorResponse('UNAUTHENTICATED', '세션이 만료되었습니다. 새로고침 후 다시 시도해주세요.', requestId);
  }
  if (!(await verifyCsrf(env.SESSION_SECRET, submitToken, request.headers.get('X-CSRF-Token')))) {
    return errorResponse('CSRF_FAILED', '보안 검증에 실패했습니다.', requestId);
  }

  const body = (await readJsonBody(request)) as { turnstileToken?: unknown };
  if (typeof body.turnstileToken !== 'string') {
    return errorResponse('BAD_REQUEST', '보안 확인 정보가 필요합니다.', requestId);
  }

  // 접속 IP는 중계 서버가 확인해 서명한 값이다.
  const remoteIp = request.headers.get('X-FS-Client-Ip');
  // 발급용 action token. 투표 제출에는 다른 action을 요구한다.
  const turnstile = await verifyTurnstile(
    {
      mode: env.TURNSTILE_MODE === 'mock' ? 'mock' : 'live',
      secret: env.TURNSTILE_SECRET,
      allowedHostnames: allowedHostnames(env),
      environment: env.ENVIRONMENT,
    },
    {
      token: body.turnstileToken,
      action: 'voter_session',
      remoteIp,
      idempotencyKey: requestId,
      now: Date.now(),
    },
  );
  if (!turnstile.ok) {
    return errorResponse('CHALLENGE_FAILED', '보안 확인에 실패했습니다. 다시 시도해주세요.', requestId);
  }

  // 기존 voter cookie가 유효하면 그대로 쓴다.
  const existing = readCookie(request, names.voter);
  const voterToken = existing ?? newSessionToken();
  const tokenHash = await computeSessionHash(env.SESSION_SECRET, voterToken);
  const rateSubjectHmac = await hmacSha256Hex(env.IP_HMAC_KEY, `voter-session:${remoteIp ?? 'unknown'}`);

  const session = unwrap(
    await env.DATA.issueVoterSession({
      campaignSlug: env.CAMPAIGN_SLUG,
      tokenHash,
      rateSubjectHmac,
      requestId,
    }),
  );

  return jsonResponse({ epoch: session.epoch, expiresAt: session.expiresAt }, 201, {
    'Set-Cookie': setCookie(names.voter, voterToken, VOTER_COOKIE_TTL_SECONDS, env.ENVIRONMENT),
  });
}

export async function handleVoteStatus(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  void requestId;
  const names = cookieNames(env.ENVIRONMENT);
  const voterToken = readCookie(request, names.voter);
  const tokenHash = voterToken === null ? null : await computeSessionHash(env.SESSION_SECRET, voterToken);
  const status = unwrap(await env.DATA.getVoteStatus(env.CAMPAIGN_SLUG, tokenHash));
  return jsonResponse(status, 200);
}

export async function handleCandidates(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  void request;
  void requestId;
  const view = unwrap(await env.DATA.getCandidates(env.CAMPAIGN_SLUG));
  // setId·setRevision은 투표 제출 검증에 필요하며 후보 개인정보는 포함하지 않는다.
  return jsonResponse(view, 200);
}

export async function handleVote(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  if (!isSameOriginRequest(request, allowedOrigins(env))) {
    return errorResponse('CSRF_FAILED', '요청 출처를 확인할 수 없습니다.', requestId);
  }
  const names = cookieNames(env.ENVIRONMENT);
  const submitToken = readCookie(request, names.submit);
  if (submitToken === null) {
    return errorResponse('UNAUTHENTICATED', '세션이 만료되었습니다. 새로고침 후 다시 시도해주세요.', requestId);
  }
  if (!(await verifyCsrf(env.SESSION_SECRET, submitToken, request.headers.get('X-CSRF-Token')))) {
    return errorResponse('CSRF_FAILED', '보안 검증에 실패했습니다.', requestId);
  }
  const voterToken = readCookie(request, names.voter);
  if (voterToken === null) {
    return errorResponse('UNAUTHENTICATED', '투표 참여 정보를 다시 확인해주세요.', requestId);
  }
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey === null || !UUID_RE.test(idempotencyKey)) {
    return errorResponse('BAD_REQUEST', '요청 식별자가 올바르지 않습니다.', requestId);
  }

  const raw = (await readJsonBody(request)) as Record<string, unknown>;
  const allowed = ['candidateId', 'setId', 'turnstileToken'];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) return errorResponse('BAD_REQUEST', `허용되지 않은 field: ${key}`, requestId);
  }
  const candidateId = raw['candidateId'];
  const setId = raw['setId'];
  const turnstileToken = raw['turnstileToken'];
  if (typeof candidateId !== 'string' || typeof setId !== 'string' || typeof turnstileToken !== 'string') {
    return errorResponse('BAD_REQUEST', '요청 형식이 올바르지 않습니다.', requestId);
  }

  // 접속 IP는 중계 서버가 확인해 서명한 값이다.
  const remoteIp = request.headers.get('X-FS-Client-Ip');
  const turnstile = await verifyTurnstile(
    {
      mode: env.TURNSTILE_MODE === 'mock' ? 'mock' : 'live',
      secret: env.TURNSTILE_SECRET,
      allowedHostnames: allowedHostnames(env),
      environment: env.ENVIRONMENT,
    },
    { token: turnstileToken, action: 'vote', remoteIp, idempotencyKey, now: Date.now() },
  );
  if (!turnstile.ok) {
    return errorResponse('CHALLENGE_FAILED', '보안 확인에 실패했습니다. 다시 시도해주세요.', requestId);
  }

  const tokenHash = await computeSessionHash(env.SESSION_SECRET, voterToken);
  const keyHash = await keyHashOf({ scope: 'vote', sessionHash: tokenHash, key: idempotencyKey });
  // 일회용 Turnstile token은 HMAC 입력에서 제외한다.
  const requestHmac = await requestHmacOf(env.SESSION_SECRET, { candidateId, setId });
  const ipHmac = await hmacSha256Hex(env.IP_HMAC_KEY, `vote:${remoteIp ?? 'unknown'}`);
  const rateSubjectHmac = await hmacSha256Hex(env.IP_HMAC_KEY, `vote-rate:${tokenHash}`);

  const result = unwrap(
    await env.DATA.castVote({
      campaignSlug: env.CAMPAIGN_SLUG,
      tokenHash,
      candidateId,
      setId,
      idempotencyKeyHash: keyHash,
      requestHmac,
      requestId,
      ipHmac,
      ipKeyVersion: env.PII_KEY_VERSION,
      clientClass: coarseClientClass(request),
      rateSubjectHmac,
    }),
  );

  return jsonResponse({ status: 'accepted', redirect: '/voted', requestId }, result.status, {
    'Set-Cookie': setCookie(names.receipt, newSessionToken(), VOTED_COOKIE_TTL_SECONDS, env.ENVIRONMENT),
  });
}

export async function handleResult(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  void request;
  void requestId;
  const result = unwrap(await env.DATA.getResult(env.CAMPAIGN_SLUG));
  return jsonResponse(result, 200);
}

/** csrfToken은 투표에서도 같은 bootstrap을 쓴다. 응모 데이터를 만들지는 않는다. */
export async function issueBootstrapToken(env: PublicEnv, sessionToken: string): Promise<string> {
  return csrfTokenFor(env.SESSION_SECRET, sessionToken);
}
