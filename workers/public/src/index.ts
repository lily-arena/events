import {
  DomainError,
  checkContact,
  checkMessage,
  parseSubmissionInput,
  type SessionDto,
  type SubmissionSuccess,
} from '@first-seat/domain';
import type { ContentPage } from '@first-seat/content';
import {
  AAD_VERSION,
  canonicalJson,
  csrfTokenFor,
  encryptContact,
  hmacSha256Hex,
  importPublicKey,
  isSameOriginRequest,
  keyHashOf,
  maskEmail,
  maskName,
  maskPhone,
  newSessionToken,
  requestHmacOf,
  sessionHash as computeSessionHash,
  verifyCsrf,
  verifyTurnstile,
} from '@first-seat/security';
import { allowedHostnames, allowedOrigins, type PublicEnv, type RpcResult } from './env.js';
import { requireGateway } from './gateway.js';
import { clearCookie, cookieNames, readCookie, setCookie } from './cookies.js';
import { domainErrorResponse, errorResponse, jsonResponse, readJsonBody } from './http.js';
import {
  handleCandidates,
  handleResult,
  handleVote,
  handleVoteStatus,
  handleVoterSession,
} from './voting.js';

/**
 * Public Worker. 외부 수신·Turnstile·PII 암호화를 담당한다.
 * D1 binding과 PII 개인키는 갖지 않으며 Admin 메서드도 호출할 수 없다.
 *
 * 화면(SPA)은 Vercel이 서빙한다. 이 Worker는 API만 응답하고 정적 파일을 갖지 않는다.
 * 브라우저는 이 주소를 직접 부르지 않는다. Vercel 서버가 서명한 요청만 처리한다.
 * 브라우저가 보낸 Origin·쿠키·CSRF token은 중계 서버가 그대로 넘겨주므로 기존 검사도 그대로 유지한다.
 */

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const RECEIPT_TTL_SECONDS = 5 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTENT_PAGES: readonly ContentPage[] = [
  'SUBMISSION',
  'SUBMITTED',
  'VOTING',
  'VOTED',
  'WAITING',
  'RESULT',
];

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new DomainError(result.code as never, result.message, result.fieldErrors);
}

async function handleSubmissionSession(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  // bootstrap만 X-CSRF-Token 예외. Origin과 Fetch Metadata는 여기서도 검사한다.
  if (!isSameOriginRequest(request, allowedOrigins(env))) {
    return errorResponse('CSRF_FAILED', '요청 출처를 확인할 수 없습니다.', requestId);
  }
  const names = cookieNames(env.ENVIRONMENT);
  const token = newSessionToken();
  const csrfToken = await csrfTokenFor(env.SESSION_SECRET, token);
  const epoch = unwrap(await env.DATA.getEpoch(env.CAMPAIGN_SLUG));
  const body: SessionDto = {
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    epoch,
  };
  return jsonResponse(body, 201, {
    'Set-Cookie': setCookie(names.submit, token, SESSION_TTL_SECONDS, env.ENVIRONMENT),
  });
}

async function handleGetCampaign(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const rawPage = url.searchParams.get('page');
  let page: ContentPage | null = null;
  if (rawPage !== null) {
    if (!(CONTENT_PAGES as readonly string[]).includes(rawPage)) {
      return errorResponse('BAD_REQUEST', '알 수 없는 화면입니다.', requestId);
    }
    page = rawPage as ContentPage;
    const names = cookieNames(env.ENVIRONMENT);
    // 접수완료 화면은 서버가 발급한 receipt가 있을 때만 조회할 수 있다.
    if (page === 'SUBMITTED') {
      if (readCookie(request, names.receipt) === null) {
        return errorResponse('FORBIDDEN', '접수 확인 정보가 없습니다.', requestId);
      }
    }
    // 투표완료 화면은 방금 투표한 경우(receipt)뿐 아니라
    // 이미 투표를 마친 참여자가 다시 들어온 경우에도 보여준다.
    if (page === 'VOTED') {
      let allowed = readCookie(request, names.receipt) !== null;
      if (!allowed) {
        const voterToken = readCookie(request, names.voter);
        if (voterToken !== null) {
          const tokenHash = await computeSessionHash(env.SESSION_SECRET, voterToken);
          const status = await env.DATA.getVoteStatus(env.CAMPAIGN_SLUG, tokenHash);
          allowed = status.ok && status.value.voted;
        }
      }
      if (!allowed) {
        return errorResponse('FORBIDDEN', '투표 확인 정보가 없습니다.', requestId);
      }
    }
  }
  const campaign = unwrap(await env.DATA.getCampaign(env.CAMPAIGN_SLUG, page));
  // 보안 확인 공개 키는 이 Worker가 알고 있다. 화면이 위젯을 띄울 때 쓴다.
  return jsonResponse({ ...campaign, turnstileSiteKey: env.TURNSTILE_SITE_KEY }, 200);
}

async function handleSubmit(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  if (!isSameOriginRequest(request, allowedOrigins(env))) {
    return errorResponse('CSRF_FAILED', '요청 출처를 확인할 수 없습니다.', requestId);
  }
  const names = cookieNames(env.ENVIRONMENT);
  const sessionToken = readCookie(request, names.submit);
  if (sessionToken === null) {
    return errorResponse('UNAUTHENTICATED', '세션이 만료되었습니다. 새로고침 후 다시 시도해주세요.', requestId);
  }
  if (!(await verifyCsrf(env.SESSION_SECRET, sessionToken, request.headers.get('X-CSRF-Token')))) {
    return errorResponse('CSRF_FAILED', '보안 검증에 실패했습니다. 새로고침 후 다시 시도해주세요.', requestId);
  }
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey === null || !UUID_RE.test(idempotencyKey)) {
    return errorResponse('BAD_REQUEST', '요청 식별자가 올바르지 않습니다.', requestId);
  }

  const input = parseSubmissionInput(await readJsonBody(request));

  // Public도 자체 검증한다. Data Worker가 같은 검사를 다시 수행한다.
  const campaign = unwrap(await env.DATA.getCampaign(env.CAMPAIGN_SLUG, 'SUBMISSION'));
  const message = checkMessage(input.message, campaign.maxMessageLength);
  const contact = checkContact({ name: input.name, phone: input.phone, email: input.email });

  if (campaign.revision !== input.configRevision || campaign.content.versionId !== input.contentVersionId) {
    return errorResponse('CONFIG_CHANGED', '내용이 변경되었습니다. 새로고침 후 다시 확인해주세요.', requestId);
  }
  const requiredPolicyIds = campaign.policies.filter((p) => p.required).map((p) => p.id);
  const acceptedIds = input.consents.map((c) => c.policyId);
  const missing = requiredPolicyIds.filter((id) => !acceptedIds.includes(id));
  if (missing.length > 0) {
    return errorResponse('UNPROCESSABLE', '필수 동의 항목을 확인해주세요.', requestId, [
      { field: 'consents', message: '필수 동의 항목에 모두 동의해주세요.' },
    ]);
  }

  // 접속 IP는 중계 서버가 확인해 서명한 값이다. 브라우저가 보낸 값을 쓰지 않는다.
  const remoteIp = request.headers.get('X-FS-Client-Ip');
  const turnstile = await verifyTurnstile(
    {
      mode: env.TURNSTILE_MODE === 'mock' ? 'mock' : 'live',
      secret: env.TURNSTILE_SECRET,
      allowedHostnames: allowedHostnames(env),
      environment: env.ENVIRONMENT,
    },
    {
      token: input.turnstileToken,
      action: 'submission',
      remoteIp,
      idempotencyKey,
      now: Date.now(),
    },
  );
  if (!turnstile.ok) {
    return errorResponse('CHALLENGE_FAILED', '보안 확인에 실패했습니다. 다시 시도해주세요.', requestId);
  }

  const submissionId = crypto.randomUUID();
  const publicKey = await importPublicKey(env.PII_PUBLIC_KEY);
  const envelope = await encryptContact(
    publicKey,
    env.PII_KEY_VERSION,
    {
      campaignId: campaign.id,
      submissionId,
      keyVersion: env.PII_KEY_VERSION,
      aadVersion: AAD_VERSION,
    },
    contact,
  );

  const sessionHashValue = await computeSessionHash(env.SESSION_SECRET, sessionToken);
  const keyHash = await keyHashOf({
    scope: 'submission',
    sessionHash: sessionHashValue,
    key: idempotencyKey,
  });
  // 일회용 Turnstile token은 HMAC 입력에 넣지 않는다.
  const requestHmac = await requestHmacOf(env.SESSION_SECRET, {
    message: message.normalized,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    configRevision: input.configRevision,
    contentVersionId: input.contentVersionId,
    consents: [...acceptedIds].sort(),
  });
  const rateSubjectHmac = await hmacSha256Hex(env.IP_HMAC_KEY, `submit:${remoteIp ?? 'unknown'}`);

  const result = unwrap(
    await env.DATA.submit({
      campaignSlug: env.CAMPAIGN_SLUG,
      submissionId,
      message: message.normalized,
      configRevision: input.configRevision,
      contentVersionId: input.contentVersionId,
      consentPolicyIds: [...acceptedIds].sort(),
      envelope: {
        ciphertext: envelope.ciphertext,
        wrappedDek: envelope.wrappedDek,
        iv: envelope.iv,
        keyVersion: envelope.keyVersion,
        aadVersion: envelope.aadVersion,
        maskedName: maskName(contact.name),
        maskedPhone: maskPhone(contact.phone),
        maskedEmail: maskEmail(contact.email),
      },
      sessionHash: sessionHashValue,
      idempotencyKeyHash: keyHash,
      requestHmac,
      requestId,
      rateSubjectHmac,
    }),
  );

  // receipt cookie 값에는 응모 ID·문구·개인정보를 넣지 않는다.
  const body: SubmissionSuccess = { status: 'accepted', redirect: '/submitted', requestId };
  return jsonResponse(body, result.status, {
    'Set-Cookie': setCookie(names.receipt, newSessionToken(), RECEIPT_TTL_SECONDS, env.ENVIRONMENT),
  });
}

async function route(request: Request, env: PublicEnv, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/submission-session' && request.method === 'POST') {
    return handleSubmissionSession(request, env, requestId);
  }
  if (path === '/api/campaign' && request.method === 'GET') {
    return handleGetCampaign(request, env, requestId);
  }
  if (path === '/api/submissions' && request.method === 'POST') {
    return handleSubmit(request, env, requestId);
  }
  if (path === '/api/voter-session' && request.method === 'POST') {
    return handleVoterSession(request, env, requestId);
  }
  if (path === '/api/vote-status' && request.method === 'GET') {
    return handleVoteStatus(request, env, requestId);
  }
  if (path === '/api/candidates' && request.method === 'GET') {
    return handleCandidates(request, env, requestId);
  }
  if (path === '/api/votes' && request.method === 'POST') {
    return handleVote(request, env, requestId);
  }
  if (path === '/api/result' && request.method === 'GET') {
    return handleResult(request, env, requestId);
  }
  // 화면은 Vercel이 서빙한다. API 외의 경로는 이 Worker가 처리하지 않는다.
  return errorResponse('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', requestId);
}

export default {
  async fetch(request: Request, env: PublicEnv): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      // 본문은 한 번만 읽을 수 있다. 서명 검증에 쓴 뒤 같은 내용으로 요청을 다시 만들어 넘긴다.
      const bodyText =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
      const context = await requireGateway(request, env, bodyText);
      const forwarded =
        bodyText.length === 0
          ? new Request(request.url, { method: request.method, headers: request.headers })
          : new Request(request.url, { method: request.method, headers: request.headers, body: bodyText });
      // 개발 모드에서는 중계 서버가 없으므로 여기서 접속 IP를 채운다.
      if (forwarded.headers.get('X-FS-Client-Ip') === null && context.clientIp.length > 0) {
        forwarded.headers.set('X-FS-Client-Ip', context.clientIp);
      }
      return await route(forwarded, env, requestId);
    } catch (error) {
      if (error instanceof DomainError) return domainErrorResponse(error, requestId);
      // 입력값을 오류 로그에 남기지 않는다. 개발에서만 원인을 알 수 있게 자세히 남긴다.
      if (env.ENVIRONMENT !== 'production' && error instanceof Error) {
        console.error('unhandled', requestId, error.name, error.message, error.stack);
      } else {
        console.error('unhandled', requestId, error instanceof Error ? error.name : 'unknown');
      }
      return errorResponse('UNAVAILABLE', '잠시 후 다시 시도해주세요.', requestId);
    }
  },
} satisfies ExportedHandler<PublicEnv>;
