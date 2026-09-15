/*
 * 참고: 아래는 패키지 이름(@first-seat/...)이 아니라 상대 경로로 가져온다.
 * Vercel Edge 번들러가 워크스페이스 패키지의 TypeScript 원본을 해석하지 못해
 * 배포가 실패하기 때문이다. 코드를 복사하지 않고 같은 원본을 그대로 쓴다.
 */
import {
  completeLogin,
  createSessionValue,
  jsonError,
  readSessionValue,
  startLogin,
} from '../../../packages/relay/src/index.js';
import {
  ADMIN_OAUTH_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearCookie,
  readCookie,
  setCookie,
} from '../src/server/cookies.js';

/**
 * 회사 계정 로그인. Google Workspace OpenID Connect.
 *
 * 로그인 시작 → 구글 → 이 서버로 복귀 순서로 진행한다.
 * 복귀할 때 서버가 id_token 서명과 회사 도메인을 직접 확인하고 로그인 쿠키를 발급한다.
 * 로그인 쿠키는 이 화면 호스트 전용이며 Cloudflare로는 신원만 서명해 전달한다.
 */
export const config = { runtime: 'edge' };

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;

interface Env {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  allowedDomain: string;
}

function readEnv(): Env | null {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const sessionSecret = process.env['SESSION_SECRET'];
  const allowedDomain = process.env['COMPANY_DOMAIN'] ?? 'seoularena.net';
  if (!clientId?.trim() || !clientSecret?.trim() || !sessionSecret?.trim()) return null;
  return { clientId, clientSecret, sessionSecret, allowedDomain };
}

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** 로그인 후 돌아갈 화면. 같은 사이트 안의 경로만 허용해 외부로 보내지 않는다. */
function safeReturnPath(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/u.test(raw)) return '/';
  return raw;
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop() ?? '';
  const env = readEnv();
  if (env === null) return jsonError(503, 'UNAVAILABLE', '회사 계정 로그인 설정이 아직 완료되지 않았습니다.');

  const redirectUri = `${url.origin}/api/auth/callback`;

  if (action === 'me') {
    const identity = await readSessionValue(env.sessionSecret, readCookie(request, ADMIN_SESSION_COOKIE));
    if (identity === null) return jsonError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    return new Response(JSON.stringify({ email: identity.email }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (action === 'logout') {
    return redirectTo('/', [clearCookie(ADMIN_SESSION_COOKIE), clearCookie(ADMIN_OAUTH_COOKIE)]);
  }

  if (action === 'login') {
    const started = await startLogin({
      clientId: env.clientId,
      redirectUri,
      hostedDomain: env.allowedDomain,
    });
    const pending = JSON.stringify({
      state: started.state,
      nonce: started.nonce,
      codeVerifier: started.codeVerifier,
      returnTo: safeReturnPath(url.searchParams.get('redirect')),
    });
    const value = await createSessionValue(
      env.sessionSecret,
      { provider: 'pending', subject: pending, email: '' },
      OAUTH_TTL_SECONDS,
    );
    return redirectTo(started.url, [setCookie(ADMIN_OAUTH_COOKIE, value, OAUTH_TTL_SECONDS)]);
  }

  if (action === 'callback') {
    const error = url.searchParams.get('error');
    if (error !== null) {
      return redirectTo(`/?login=failed`, [clearCookie(ADMIN_OAUTH_COOKIE)]);
    }
    const pendingIdentity = await readSessionValue(env.sessionSecret, readCookie(request, ADMIN_OAUTH_COOKIE));
    if (pendingIdentity === null || pendingIdentity.provider !== 'pending') {
      return redirectTo('/?login=expired', [clearCookie(ADMIN_OAUTH_COOKIE)]);
    }
    let pending: { state: string; nonce: string; codeVerifier: string; returnTo: string };
    try {
      pending = JSON.parse(pendingIdentity.subject) as typeof pending;
    } catch {
      return redirectTo('/?login=expired', [clearCookie(ADMIN_OAUTH_COOKIE)]);
    }
    if (url.searchParams.get('state') !== pending.state) {
      return redirectTo('/?login=failed', [clearCookie(ADMIN_OAUTH_COOKIE)]);
    }
    const code = url.searchParams.get('code');
    if (code === null) return redirectTo('/?login=failed', [clearCookie(ADMIN_OAUTH_COOKIE)]);

    try {
      const result = await completeLogin({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        redirectUri,
        code,
        codeVerifier: pending.codeVerifier,
        nonce: pending.nonce,
        allowedDomain: env.allowedDomain,
      });
      const session = await createSessionValue(env.sessionSecret, result.identity, SESSION_TTL_SECONDS);
      return redirectTo(safeReturnPath(pending.returnTo), [
        setCookie(ADMIN_SESSION_COOKIE, session, SESSION_TTL_SECONDS),
        clearCookie(ADMIN_OAUTH_COOKIE),
      ]);
    } catch {
      // 실패 사유를 주소에 자세히 남기지 않는다.
      return redirectTo('/?login=denied', [clearCookie(ADMIN_OAUTH_COOKIE)]);
    }
  }

  return jsonError(404, 'NOT_FOUND', '알 수 없는 경로입니다.');
}
