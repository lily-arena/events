/*
 * 참고: 아래는 패키지 이름(@first-seat/...)이 아니라 상대 경로로 가져온다.
 * Vercel Edge 번들러가 워크스페이스 패키지의 TypeScript 원본을 해석하지 못해
 * 배포가 실패하기 때문이다. 코드를 복사하지 않고 같은 원본을 그대로 쓴다.
 */
import { base64UrlEncode, hmacSha256Hex, randomBytes, timingSafeEqual } from '../../security/src/index.js';
import type { GatewayIdentity } from '../../security/src/index.js';

/**
 * 회사 계정 로그인. Google Workspace의 OpenID Connect를 쓴다.
 *
 * 로그인 입력란에 회사 메일 주소를 적었다는 이유로 통과시키지 않는다.
 * Google이 서명한 id_token을 서버가 직접 검증하고, 서명·발급자·대상·만료·
 * 이메일 인증 여부·회사 도메인(hd)을 모두 확인한 뒤에만 신원으로 인정한다.
 */

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_TTL_MS = 10 * 60 * 1000;

export const PROVIDER = 'google';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

async function loadJwks(): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache !== null && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error('구글 인증 키를 가져오지 못했습니다.');
  const body = (await response.json()) as { keys: Jwk[] };
  jwksCache = { fetchedAt: now, keys: body.keys };
  return body.keys;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

export interface LoginStart {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

/** 로그인 시작 주소를 만든다. PKCE와 nonce로 응답 가로채기·재사용을 막는다. */
export async function startLogin(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly hostedDomain: string;
}): Promise<LoginStart> {
  const state = base64UrlEncode(randomBytes(24));
  const nonce = base64UrlEncode(randomBytes(24));
  const codeVerifier = base64UrlEncode(randomBytes(48));
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await sha256Base64Url(codeVerifier),
    code_challenge_method: 'S256',
    // 회사 계정 화면을 먼저 보여준다. 이것만으로 도메인이 보장되지는 않아 서버가 다시 검증한다.
    hd: input.hostedDomain,
    prompt: 'select_account',
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, nonce, codeVerifier };
}

interface TokenResponse {
  id_token?: string;
  error?: string;
}

interface IdTokenPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  azp?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
}

export interface LoginResult {
  readonly identity: GatewayIdentity;
}

/** 인증 코드를 토큰으로 바꾸고 신원을 확인한다. 조건을 하나라도 못 채우면 거절한다. */
export async function completeLogin(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly allowedDomain: string;
  readonly now?: number;
}): Promise<LoginResult> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
    }).toString(),
  });
  const token = (await response.json()) as TokenResponse;
  if (!response.ok || typeof token.id_token !== 'string') {
    throw new Error('구글 로그인 응답을 받지 못했습니다.');
  }

  const parts = token.id_token.split('.');
  if (parts.length !== 3) throw new Error('인증 정보 형식이 올바르지 않습니다.');
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  const header = decodeSegment<{ alg: string; kid: string }>(rawHeader);
  if (header.alg !== 'RS256') throw new Error('지원하지 않는 서명 방식입니다.');

  const jwk = (await loadJwks()).find((key) => key.kid === header.kid);
  if (jwk === undefined) throw new Error('인증 키를 찾을 수 없습니다.');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!valid) throw new Error('서명 검증에 실패했습니다.');

  const payload = decodeSegment<IdTokenPayload>(rawPayload);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new Error('발급자가 올바르지 않습니다.');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(input.clientId)) throw new Error('이 서비스에 대한 인증이 아닙니다.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new Error('계정 식별자가 올바르지 않습니다.');
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + 60) throw new Error('발급 시각이 올바르지 않습니다.');
  if ((audiences.length > 1 || payload.azp !== undefined) && payload.azp !== input.clientId) throw new Error('인증 대상이 일치하지 않습니다.');
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('인증이 만료되었습니다.');
  if (payload.nonce !== input.nonce) throw new Error('로그인 요청이 일치하지 않습니다.');
  if (payload.email_verified !== true) throw new Error('확인되지 않은 메일 계정입니다.');

  const email = (payload.email ?? '').toLowerCase();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  // hd와 메일 도메인을 모두 확인한다. 둘 중 하나만 보면 외부 계정이 통과할 수 있다.
  if (payload.hd !== input.allowedDomain || domain !== input.allowedDomain) {
    throw new Error('서울아레나 회사 계정만 사용할 수 있습니다.');
  }

  return { identity: { provider: PROVIDER, subject: payload.sub, email } };
}

/* ------------------------------------------------------------------ */
/* 로그인 세션 쿠키                                                     */
/* ------------------------------------------------------------------ */

export interface SessionPayload extends GatewayIdentity {
  readonly exp: number;
}

function toBase64Url(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function fromBase64Url(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/** 서버가 서명한 로그인 쿠키 값을 만든다. 내용은 브라우저가 읽을 수 있지만 고칠 수는 없다. */
export async function createSessionValue(
  secret: string,
  identity: GatewayIdentity,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const payload: SessionPayload = {
    ...identity,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = await hmacSha256Hex(secret, `session:${encoded}`);
  return `${encoded}.${signature}`;
}

/** 로그인 쿠키를 확인한다. 서명이나 만료가 맞지 않으면 null. */
export async function readSessionValue(
  secret: string,
  value: string | null,
  now: number = Date.now(),
): Promise<GatewayIdentity | null> {
  if (value === null || value.length === 0) return null;
  const at = value.lastIndexOf('.');
  if (at <= 0) return null;
  const encoded = value.slice(0, at);
  const signature = value.slice(at + 1);
  const expected = await hmacSha256Hex(secret, `session:${encoded}`);
  if (!timingSafeEqual(expected, signature)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(encoded)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(now / 1000)) return null;
  if (typeof payload.subject !== 'string' || typeof payload.email !== 'string') return null;
  return { provider: payload.provider, subject: payload.subject, email: payload.email };
}
