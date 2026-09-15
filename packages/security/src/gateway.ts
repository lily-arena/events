import { hmacSha256Hex, sha256Hex } from './hash.js';
import { timingSafeEqual } from './bytes.js';

/**
 * Vercel 서버와 Cloudflare API 사이의 요청 인증.
 *
 * 브라우저는 자기 화면 주소의 /api만 부르고, Vercel 서버가 이 서명을 붙여 Cloudflare로 전달한다.
 * 그래서 Cloudflare API 호스트에는 브라우저가 직접 접근할 일이 없다.
 *
 * 서명은 메서드·경로·본문·시각·nonce·전달 identity를 모두 묶는다.
 * 하나라도 바뀌면 검증에 실패하므로 중간에서 경로나 본문을 바꿔치기할 수 없다.
 * 시각을 함께 묶어 오래된 요청을 다시 쓰는 것도 막는다.
 *
 * 이 서명은 '요청이 우리 서버에서 왔다'는 것만 보장한다.
 * 사람의 신원은 Vercel 서버가 회사 로그인으로 확인한 결과이며 identity로 함께 전달한다.
 */

export const GATEWAY_HEADERS = {
  timestamp: 'X-FS-Timestamp',
  nonce: 'X-FS-Nonce',
  signature: 'X-FS-Signature',
  identity: 'X-FS-Identity',
  clientIp: 'X-FS-Client-Ip',
} as const;

/** 브라우저가 보낸 값을 그대로 믿으면 안 되는 헤더. 중계 서버가 지우고 자기 값으로 덮는다. */
export const FORBIDDEN_CLIENT_HEADERS = [
  GATEWAY_HEADERS.timestamp,
  GATEWAY_HEADERS.nonce,
  GATEWAY_HEADERS.signature,
  GATEWAY_HEADERS.identity,
  GATEWAY_HEADERS.clientIp,
  'X-Dev-Access-Subject',
  'X-Dev-Access-Email',
  'CF-Connecting-IP',
] as const;

export interface GatewayIdentity {
  /** 인증 제공자. 지금은 Google Workspace만 쓴다. */
  readonly provider: string;
  /** 제공자가 부여한 고유 식별자. 이메일이 바뀌어도 유지된다. */
  readonly subject: string;
  readonly email: string;
}

export interface SignedHeaders {
  readonly [key: string]: string;
}

const MAX_SKEW_MS = 2 * 60 * 1000;

function encodeIdentity(identity: GatewayIdentity | null): string {
  if (identity === null) return '';
  const json = JSON.stringify({
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email,
  });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

function decodeIdentity(encoded: string): GatewayIdentity | null {
  if (encoded.length === 0) return null;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<GatewayIdentity>;
  if (
    typeof parsed.provider !== 'string' ||
    typeof parsed.subject !== 'string' ||
    typeof parsed.email !== 'string'
  ) {
    return null;
  }
  return { provider: parsed.provider, subject: parsed.subject, email: parsed.email };
}

async function messageFor(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  identity: string;
  clientIp: string;
}): Promise<string> {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
    input.identity,
    input.clientIp,
  ].join('\n');
}

/** 중계 서버가 붙일 헤더를 만든다. body는 문자열 그대로 넣는다. */
export async function signGatewayRequest(
  secret: string,
  input: {
    readonly method: string;
    readonly path: string;
    readonly body: string;
    readonly identity: GatewayIdentity | null;
    readonly clientIp: string;
    readonly now?: number;
  },
): Promise<SignedHeaders> {
  const timestamp = String(input.now ?? Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(input.body);
  const identity = encodeIdentity(input.identity);
  const signature = await hmacSha256Hex(
    secret,
    await messageFor({
      method: input.method,
      path: input.path,
      timestamp,
      nonce,
      bodyHash,
      identity,
      clientIp: input.clientIp,
    }),
  );
  const headers: Record<string, string> = {
    [GATEWAY_HEADERS.timestamp]: timestamp,
    [GATEWAY_HEADERS.nonce]: nonce,
    [GATEWAY_HEADERS.signature]: signature,
    [GATEWAY_HEADERS.clientIp]: input.clientIp,
  };
  if (identity.length > 0) headers[GATEWAY_HEADERS.identity] = identity;
  return headers;
}

export interface GatewayVerification {
  readonly ok: boolean;
  readonly reason?: string;
  readonly identity?: GatewayIdentity | null;
  readonly clientIp?: string;
}

/** Cloudflare Worker가 요청을 검증한다. 실패하면 어떤 값도 신뢰하지 않는다. */
export async function verifyGatewayRequest(
  secret: string,
  request: Request,
  body: string,
  now: number = Date.now(),
): Promise<GatewayVerification> {
  const timestamp = request.headers.get(GATEWAY_HEADERS.timestamp);
  const nonce = request.headers.get(GATEWAY_HEADERS.nonce);
  const signature = request.headers.get(GATEWAY_HEADERS.signature);
  if (timestamp === null || nonce === null || signature === null) {
    return { ok: false, reason: '서명이 없습니다.' };
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_SKEW_MS) {
    return { ok: false, reason: '요청 시각이 유효 범위를 벗어났습니다.' };
  }
  const identityRaw = request.headers.get(GATEWAY_HEADERS.identity) ?? '';
  const clientIp = request.headers.get(GATEWAY_HEADERS.clientIp) ?? '';
  const expected = await hmacSha256Hex(
    secret,
    await messageFor({
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp,
      nonce,
      bodyHash: await sha256Hex(body),
      identity: identityRaw,
      clientIp,
    }),
  );
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: '서명이 일치하지 않습니다.' };
  }
  let identity: GatewayIdentity | null = null;
  try {
    identity = decodeIdentity(identityRaw);
  } catch {
    return { ok: false, reason: 'identity 형식이 올바르지 않습니다.' };
  }
  return { ok: true, identity, clientIp };
}
