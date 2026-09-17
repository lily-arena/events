import {publicReadCacheTtl,publicCacheHeaders} from './public-cache.js';
/*
 * 참고: 아래는 패키지 이름(@first-seat/...)이 아니라 상대 경로로 가져온다.
 * Vercel Edge 번들러가 워크스페이스 패키지의 TypeScript 원본을 해석하지 못해
 * 배포가 실패하기 때문이다. 코드를 복사하지 않고 같은 원본을 그대로 쓴다.
 */
import {
  FORBIDDEN_CLIENT_HEADERS,
  signGatewayRequest,
  type GatewayIdentity,
} from '../../security/src/index.js';

/**
 * Vercel 서버에서 Cloudflare API로 요청을 전달한다.
 *
 * 브라우저는 자기 화면 주소의 /api만 부른다. 그래서 쿠키는 화면 호스트의 같은 출처 쿠키가 되고
 * 회사 DNS에는 화면 주소만 추가하면 된다.
 *
 * 브라우저가 보낸 값 중 신뢰할 수 없는 헤더는 지우고, 접속 IP와 로그인 신원은
 * 이 서버가 확인한 값으로 다시 채워 서명한다.
 */

/** 응답 본문을 만들 때 쓰는 공통 헤더. */
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message, requestId: '' }), { status, headers: JSON_HEADERS });
}

/**
 * 접속자 IP.
 *
 * Vercel이 직접 채우는 헤더만 본다. 브라우저가 임의로 넣은 X-Forwarded-For는 믿지 않는다.
 * 값이 없으면 빈 문자열을 주고, 서버는 이를 '알 수 없음'으로 처리한다.
 */
export function clientIpOf(request: Request): string {
  const real = request.headers.get('x-real-ip');
  if (real !== null && real.length > 0) return real;
  const forwarded = request.headers.get('x-vercel-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim() ?? '';
  return first;
}

export interface RelayOptions {
  /** Cloudflare Worker 주소. 예: https://first-seat-public-prod.example.workers.dev */
  readonly upstreamBase: string;
  readonly secret: string;
  /** 회사 로그인으로 확인한 신원. 공개 API에는 없다. */
  readonly identity: GatewayIdentity | null;
  /** 전달하지 않을 요청 헤더를 더 지정할 때 쓴다. */
  readonly dropHeaders?: readonly string[];
}

/** 브라우저 요청을 그대로 Cloudflare API로 넘기고 응답을 그대로 돌려준다. */
export async function relayRequest(request: Request, options: RelayOptions): Promise<Response> {
  const url = new URL(request.url);
  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  const clientIp = clientIpOf(request);

  const headers = new Headers();
  const drop = new Set(
    [...FORBIDDEN_CLIENT_HEADERS, ...(options.dropHeaders ?? [])].map((name) => name.toLowerCase()),
  );
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (drop.has(lower)) continue;
    // hop-by-hop 헤더와 길이 정보는 fetch가 다시 계산한다.
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers.set(key, value);
  }

  const signed = await signGatewayRequest(options.secret, {
    method: request.method,
    path: url.pathname,
    body,
    identity: options.identity,
    clientIp,
  });
  for (const [key, value] of Object.entries(signed)) headers.set(key, value);

  let upstream: Response;
  try {
    upstream = await fetch(`${options.upstreamBase}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(body.length === 0 ? {} : { body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError(502, 'UNAVAILABLE', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    // Set-Cookie는 여러 개일 수 있어 아래에서 따로 옮긴다.
    if (lower === 'set-cookie' || lower === 'content-encoding' || lower === 'content-length') continue;
    responseHeaders.set(key, value);
  }
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    responseHeaders.append('Set-Cookie', cookie);
  }
  // Cache only known public reads; ignore upstream cache headers on every other route.
  const ttl=publicReadCacheTtl(request.method,url.pathname,upstream.status,upstream.headers.has('set-cookie'));
  responseHeaders.delete('CDN-Cache-Control');
  responseHeaders.delete('Vercel-CDN-Cache-Control');
  responseHeaders.set('Cache-Control','no-store');
  if(ttl)for(const [key,value] of Object.entries(publicCacheHeaders(ttl)))responseHeaders.set(key,value);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export * from './google.js';
