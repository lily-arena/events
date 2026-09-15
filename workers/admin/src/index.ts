import { DomainError, STATUS_FOR_CODE, type ErrorBody, type ErrorCode } from '@first-seat/domain';
import type { ContentPage } from '@first-seat/content';
import {
  AAD_VERSION,
  base64UrlEncode,
  csrfTokenFor,
  decryptContact,
  importPrivateKey,
  isSameOriginRequest,
  newSessionToken,
  randomBytes,
  sessionHash as computeSessionHash,
  sha256Hex,
  verifyCsrf,
} from '@first-seat/security';
import { allowedOrigins, type AdminEnv, type RpcResult } from './env.js';
import { authenticate, type AuthenticatedRequest } from './access.js';

/**
 * Admin Worker.
 * 인증된 회사 계정 한 명이 모든 운영 기능을 사용한다. 역할 분리와 타인 승인 절차는 없다.
 * D1 binding은 갖지 않으며 데이터 접근은 모두 AdminData RPC를 통한다.
 *
 * 화면(SPA)과 회사 계정 로그인은 Vercel이 맡는다. 이 Worker는 API만 응답한다.
 * 브라우저는 이 주소를 직접 부르지 않는다. Vercel 서버가 서명하고 신원을 담아 보낸 요청만 처리한다.
 */

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;

function cookieName(environment: string): string {
  return environment === 'production' ? '__Host-fs-admin' : 'fs-admin';
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key !== undefined && key.trim() === name) return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}

function setCookie(name: string, value: string, maxAge: number, environment: string): string {
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (environment === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

function json(body: unknown, status: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(JSON.stringify(body), { status, headers });
}

function fail(code: ErrorCode, message: string, requestId: string): Response {
  const body: ErrorBody = { code, message, requestId };
  return json(body, STATUS_FOR_CODE[code], {});
}

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new DomainError(result.code as never, result.message, result.fieldErrors);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new DomainError('BAD_REQUEST', '요청 본문이 너무 큽니다.');
  }
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new DomainError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw new DomainError('BAD_REQUEST', `${key}가 필요합니다.`);
  return value;
}

function num(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('BAD_REQUEST', `${key}가 필요합니다.`);
  }
  return value;
}

/** 변경 요청은 서버 session + CSRF 헤더를 모두 요구한다. */
async function requireMutationGuards(request: Request, env: AdminEnv): Promise<void> {
  if (!isSameOriginRequest(request, allowedOrigins(env))) {
    throw new DomainError('CSRF_FAILED', '요청 출처를 확인할 수 없습니다.');
  }
  const sessionToken = readCookie(request, cookieName(env.ENVIRONMENT));
  if (sessionToken === null) throw new DomainError('UNAUTHENTICATED', '세션이 만료되었습니다.');
  if (!(await verifyCsrf(env.SESSION_SECRET, sessionToken, request.headers.get('X-CSRF-Token')))) {
    throw new DomainError('CSRF_FAILED', '보안 검증에 실패했습니다.');
  }
}

async function handle(
  request: Request,
  env: AdminEnv,
  requestId: string,
  auth: AuthenticatedRequest,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const slug = env.CAMPAIGN_SLUG;

  if (!path.startsWith('/api/admin/')) {
    // 화면은 Vercel이 서빙한다. 이 Worker는 Admin API 외의 경로를 처리하지 않는다.
    return fail('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', requestId);
  }

  /*
   * 모든 Admin API는 회사 계정 인증을 먼저 통과해야 한다.
   * 실제 로그인에서는 사람을 이메일이 아니라 provider와 고유 식별자로 구분하고,
   * 처음 로그인한 회사 계정은 운영자로 등록한다. 비활성 계정은 다시 살아나지 않는다.
   */
  const subject =
    env.GATEWAY_MODE === 'dev'
      ? auth.identity.subject
      : unwrap(
          await env.DATA.ensureAdministrator(
            auth.identity.provider,
            auth.identity.subject,
            auth.identity.email,
          ),
        ).accessSubject;

  if (path === '/api/admin/me' && request.method === 'GET') {
    const me = unwrap(await env.DATA.whoami(subject));
    let sessionToken = readCookie(request, cookieName(env.ENVIRONMENT)) ?? newSessionToken();
    let session = await env.DATA.ensureSession(subject, await computeSessionHash(env.SESSION_SECRET, sessionToken));
    if (!session.ok) {
      sessionToken = newSessionToken();
      session = await env.DATA.ensureSession(subject, await computeSessionHash(env.SESSION_SECRET, sessionToken));
    }
    unwrap(session);
    const csrfToken = await csrfTokenFor(env.SESSION_SECRET, sessionToken);
    return json({ ...me, csrfToken }, 200, {
      'Set-Cookie': setCookie(cookieName(env.ENVIRONMENT), sessionToken, SESSION_TTL_SECONDS, env.ENVIRONMENT),
    });
  }

  if (request.method !== 'GET') await requireMutationGuards(request, env);

  /** 개인정보 열람에 쓰는 서버 session id */
  async function currentSessionId(): Promise<string> {
    const sessionToken = readCookie(request, cookieName(env.ENVIRONMENT));
    if (sessionToken === null) throw new DomainError('UNAUTHENTICATED', '세션이 필요합니다.');
    const session = unwrap(
      await env.DATA.ensureSession(subject, await computeSessionHash(env.SESSION_SECRET, sessionToken)),
    );
    return session.sessionId;
  }

  // --- 대시보드와 공개 전환 ---
  if (path === '/api/admin/dashboard' && request.method === 'GET') {
    return json(unwrap(await env.DATA.dashboard(subject, slug)), 200);
  }
  if (path === '/api/admin/campaign/reset-test-data' && request.method === 'POST') {
    const body = await readBody(request);
    return json(unwrap(await env.DATA.resetCampaignTestData(subject, slug, num(body, 'expectedRevision'), str(body, 'resetId'), str(body, 'confirmation'), requestId)), 200);
  }
  if (path === '/api/admin/campaign-actions/preview' && request.method === 'POST') {
    const body = await readBody(request);
    return json(unwrap(await env.DATA.previewCampaignAction(subject, slug, str(body, 'action'))), 200);
  }
  if (path === '/api/admin/campaign-actions' && request.method === 'POST') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.executeCampaignAction(
          subject,
          slug,
          str(body, 'action'),
          str(body, 'idempotencyKey'),
          num(body, 'expectedRevision'),
          // 운영자가 확인창에서 실제로 본 내용의 지문. 서버가 지금 공개할 내용과 대조한다.
          str(body, 'expectedSnapshotDigest'),
          requestId,
        ),
      ),
      200,
    );
  }

  // --- 캠페인 설정 ---
  if (path === '/api/admin/campaign' && request.method === 'GET') {
    return json(unwrap(await env.DATA.campaign(subject, slug)), 200);
  }
  if (path === '/api/admin/campaign/config' && request.method === 'PUT') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.updateConfig(subject, {
          campaignSlug: slug,
          maxMessageLength: num(body, 'maxMessageLength'),
          submissionStart: (body['submissionStart'] as number | null) ?? null,
          submissionEnd: (body['submissionEnd'] as number | null) ?? null,
          votingStart: (body['votingStart'] as number | null) ?? null,
          votingEnd: (body['votingEnd'] as number | null) ?? null,
          absolutePiiDeadline: (body['absolutePiiDeadline'] as number | null) ?? null,
          expectedRevision: num(body, 'expectedRevision'),
          requestId,
        }),
      ),
      200,
    );
  }
  if (path === '/api/admin/campaign/pause' && request.method === 'POST') {
    const body = await readBody(request);
    return json(unwrap(await env.DATA.setPaused(subject, slug, body['paused'] === true, requestId)), 200);
  }

  // --- 응모작 심사 ---
  if (path === '/api/admin/submissions' && request.method === 'GET') {
    return json(
      unwrap(
        await env.DATA.listSubmissions(subject, {
          campaignSlug: slug,
          status: url.searchParams.get('status'),
          query: url.searchParams.get('q'),
          cursor: url.searchParams.get('cursor'),
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null,
        }),
      ),
      200,
    );
  }
  const submissionMatch = /^\/api\/admin\/submissions\/([0-9a-f-]{36})$/iu.exec(path);
  if (submissionMatch !== null) {
    const id = submissionMatch[1]!;
    if (request.method === 'GET') return json(unwrap(await env.DATA.getSubmission(subject, id)), 200);
    if (request.method === 'PATCH') {
      const body = await readBody(request);
      return json(
        unwrap(
          await env.DATA.updateSubmission(subject, {
            submissionId: id,
            status: str(body, 'status'),
            reviewerNote: typeof body['reviewerNote'] === 'string' ? body['reviewerNote'] : '',
            expectedRowVersion: num(body, 'expectedRowVersion'),
            requestId,
          }),
        ),
        200,
      );
    }
  }

  // --- 숏리스트 ---
  if (path === '/api/admin/shortlist' && request.method === 'GET') {
    return json(unwrap(await env.DATA.getShortlist(subject, slug)), 200);
  }
  if (path === '/api/admin/shortlist/order' && request.method === 'PUT') {
    const body = await readBody(request);
    return json(unwrap(await env.DATA.reorderShortlist(subject, slug, body['order'] as string[], requestId)), 200);
  }
  if (path === '/api/admin/shortlist/confirm' && request.method === 'POST') {
    const body = await readBody(request);
    // 화면이 확인한 준비 목록의 지문. 그 사이에 후보 지정이 바뀌면 확정하지 않는다.
    return json(
      unwrap(await env.DATA.confirmShortlist(subject, slug, str(body, 'expectedPreparedDigest'), requestId)),
      200,
    );
  }

  // --- 투표 현황 ---
  if (path === '/api/admin/vote-ranking' && request.method === 'GET') {
    return json(unwrap(await env.DATA.voteRanking(subject, slug)), 200);
  }
  if (path === '/api/admin/votes/monitor' && request.method === 'GET') {
    return json(unwrap(await env.DATA.monitor(subject, slug)), 200);
  }
  if (path === '/api/admin/votes/risks' && request.method === 'GET') {
    return json(unwrap(await env.DATA.risks(subject, slug, url.searchParams.get('state'))), 200);
  }
  const decisionMatch = /^\/api\/admin\/votes\/([0-9a-f-]{36})\/decisions$/iu.exec(path);
  if (decisionMatch !== null && request.method === 'POST') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.appendDecision(subject, {
          voteId: decisionMatch[1]!,
          verdict: str(body, 'verdict'),
          reason: str(body, 'reason'),
          makerId: subject,
          requestId,
        }),
      ),
      201,
    );
  }

  // --- 최종 문구 선정 ---
  if (path === '/api/admin/final-message' && request.method === 'GET') {
    return json(unwrap(await env.DATA.finalSelection(subject, slug)), 200);
  }
  if (path === '/api/admin/final-message' && request.method === 'POST') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.confirmFinalMessage(
          subject,
          slug,
          str(body, 'candidateId'),
          // 화면이 마지막으로 본 확정 문구. 그 사이에 바뀌었으면 덮어쓰지 않는다.
          str(body, 'expectedCurrentResultId'),
          requestId,
        ),
      ),
      200,
    );
  }
  const mediaMatch = /^\/api\/admin\/results\/([0-9a-f-]{36})\/media$/iu.exec(path);
  if (mediaMatch !== null && request.method === 'PUT') {
    const body = await readBody(request);
    return json(unwrap(await env.DATA.putResultMedia(subject, mediaMatch[1]!, body['media'], requestId)), 200);
  }

  // --- 화면 문구 ---
  if (path === '/api/admin/content' && request.method === 'GET') {
    const page = url.searchParams.get('page') as ContentPage | null;
    if (page === null) throw new DomainError('BAD_REQUEST', '화면을 지정해주세요.');
    return json(unwrap(await env.DATA.contentEditor(subject, slug, page)), 200);
  }
  if (path === '/api/admin/content/field' && request.method === 'PUT') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.saveContentField(subject, slug, {
          page: str(body, 'page') as ContentPage,
          key: str(body, 'key'),
          ...(body['items'] === undefined ? { text: String(body['text'] ?? '') } : { items: body['items'] as string[] }),
          expectedVersion: num(body, 'expectedVersion'),
          requestId,
        }),
      ),
      200,
    );
  }
  if (path === '/api/admin/content/fields' && request.method === 'PUT') {
    const body = await readBody(request);
    // 바꾼 항목 전부를 한 버전으로 저장한다. 하나씩 저장하면 두 번째부터 버전 충돌이 난다.
    const rawFields = Array.isArray(body['fields']) ? (body['fields'] as Record<string, unknown>[]) : [];
    if (rawFields.length === 0) throw new DomainError('BAD_REQUEST', '저장할 항목이 없습니다.');
    return json(
      unwrap(
        await env.DATA.saveContentFields(subject, slug, {
          page: str(body, 'page') as ContentPage,
          fields: rawFields.map((field) => ({
            key: str(field, 'key'),
            ...(field['items'] === undefined
              ? { text: String(field['text'] ?? '') }
              : { items: field['items'] as string[] }),
          })),
          expectedVersion: num(body, 'expectedVersion'),
          requestId,
        }),
      ),
      200,
    );
  }
  if (path === '/api/admin/content/preview' && request.method === 'POST') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.previewContentFields(subject, slug, str(body, 'page') as ContentPage, body['fields'] as never),
      ),
      200,
    );
  }

  // --- 개인정보 ---
  const maskMatch = /^\/api\/admin\/submissions\/([0-9a-f-]{36})\/mask$/iu.exec(path);
  if (maskMatch !== null && request.method === 'GET') {
    return json(unwrap(await env.DATA.getMask(subject, maskMatch[1]!, requestId)), 200);
  }
  const revealMatch = /^\/api\/admin\/submissions\/([0-9a-f-]{36})\/reveal$/iu.exec(path);
  if (revealMatch !== null && request.method === 'POST') {
    const submissionId = revealMatch[1]!;
    const body = await readBody(request);
    const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
    const sessionId = await currentSessionId();

    // 같은 로그인 세션에서 바로 연다. 별도 역할 부여나 타인 승인은 없다.
    const nonce = base64UrlEncode(randomBytes(32));
    unwrap(
      await env.DATA.createRevealGrant(subject, {
        adminSessionId: sessionId,
        submissionId,
        nonceHash: await sha256Hex(nonce),
        reason: reason.trim().length > 0 ? reason : '운영 담당자 확인',
        requestId,
      }),
    );
    const envelope = unwrap(
      await env.DATA.consumeRevealGrant(subject, {
        adminSessionId: sessionId,
        submissionId,
        nonceHash: await sha256Hex(nonce),
        requestId,
      }),
    );

    try {
      const privateKey = await importPrivateKey(env.PII_PRIVATE_KEY);
      const contact = await decryptContact(
        privateKey,
        {
          ciphertext: new Uint8Array(envelope.ciphertext),
          wrappedDek: new Uint8Array(envelope.wrappedDek),
          iv: new Uint8Array(envelope.iv),
          keyVersion: envelope.keyVersion,
          aadVersion: envelope.aadVersion,
        },
        {
          campaignId: envelope.campaignId,
          submissionId,
          keyVersion: envelope.keyVersion,
          aadVersion: envelope.aadVersion ?? AAD_VERSION,
        },
      );
      await env.DATA.recordRevealOutcome(subject, submissionId, requestId, 'SUCCESS');
      return json({ ...contact, expiresInSeconds: 60 }, 200, { 'X-Robots-Tag': 'noindex, noarchive' });
    } catch (error) {
      await env.DATA.recordRevealOutcome(subject, submissionId, requestId, 'FAILED');
      if (error instanceof DomainError) throw error;
      throw new DomainError('UNAVAILABLE', '복호화에 실패했습니다.');
    }
  }

  // --- 기록·파기 ---
  if (path === '/api/admin/audit' && request.method === 'GET') {
    return json(
      unwrap(
        await env.DATA.listAudit(subject, {
          action: url.searchParams.get('action'),
          targetId: url.searchParams.get('targetId'),
          cursor: url.searchParams.get('cursor'),
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null,
        }),
      ),
      200,
    );
  }
  if (path === '/api/admin/deletions' && request.method === 'POST') {
    const body = await readBody(request);
    return json(
      unwrap(
        await env.DATA.createDeletionJob(
          subject,
          slug,
          str(body, 'targetId'),
          str(body, 'kind'),
          str(body, 'reason'),
          requestId,
        ),
      ),
      201,
    );
  }
  const deletionMatch = /^\/api\/admin\/deletions\/([0-9a-f-]{36})$/iu.exec(path);
  if (deletionMatch !== null && request.method === 'GET') {
    return json(unwrap(await env.DATA.getDeletionJob(subject, deletionMatch[1]!)), 200);
  }
  if (path === '/api/admin/jobs/run' && request.method === 'POST') {
    return json(unwrap(await env.DATA.runJobs(subject)), 200);
  }

  // --- 정책 ---
  if (path === '/api/admin/policies' && request.method === 'GET') {
    return json(unwrap(await env.DATA.listPolicies(subject, slug)), 200);
  }

  // --- 사용 중단된 경로 ---
  if (
    path === '/api/admin/transitions/commit' ||
    path === '/api/admin/transitions/preview' ||
    /^\/api\/admin\/results\/[0-9a-f-]{36}\/(publish|approve)$/iu.test(path) ||
    path === '/api/admin/results' ||
    path === '/api/admin/jury-scores' ||
    /^\/api\/admin\/candidate-sets/iu.test(path)
  ) {
    throw new DomainError(
      'CONFLICT',
      '이 경로는 더 이상 사용하지 않습니다. 대시보드와 숏리스트, 최종 문구 선정 화면을 사용해주세요.',
    );
  }

  return fail('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.', requestId);
}

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      // 본문은 한 번만 읽을 수 있다. 서명 검증에 쓴 뒤 같은 내용으로 요청을 다시 만들어 넘긴다.
      const bodyText =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
      const auth = await authenticate(request, env, bodyText);
      const forwarded =
        bodyText.length === 0
          ? new Request(request.url, { method: request.method, headers: request.headers })
          : new Request(request.url, { method: request.method, headers: request.headers, body: bodyText });
      return await handle(forwarded, env, requestId, auth);
    } catch (error) {
      if (error instanceof DomainError) {
        const body: ErrorBody =
          error.fieldErrors.length > 0
            ? { code: error.code, message: error.message, requestId, fieldErrors: error.fieldErrors }
            : { code: error.code, message: error.message, requestId };
        return json(body, error.status, {});
      }
      if (env.ENVIRONMENT !== 'production' && error instanceof Error) {
        console.error('admin unhandled', requestId, error.name, error.message, error.stack);
      } else {
        console.error('admin unhandled', requestId, error instanceof Error ? error.name : 'unknown');
      }
      return fail('UNAVAILABLE', '잠시 후 다시 시도해주세요.', requestId);
    }
  },
} satisfies ExportedHandler<AdminEnv>;
