import { base64UrlEncode, randomBytes, timingSafeEqual } from './bytes.js';
import { hmacSha256Hex } from './hash.js';

/**
 * 서버 발급 session cookie + 별도 CSRF token(double submit).
 * bootstrap endpoint만 X-CSRF-Token 헤더 예외이며 나머지 mutation은 모두 검사한다.
 */

export function newSessionToken(): string {
  return base64UrlEncode(randomBytes(32));
}

export async function sessionHash(secret: string, token: string): Promise<string> {
  return hmacSha256Hex(secret, `session:${token}`);
}

export async function csrfTokenFor(secret: string, sessionToken: string): Promise<string> {
  return hmacSha256Hex(secret, `csrf:${sessionToken}`);
}

export async function verifyCsrf(
  secret: string,
  sessionToken: string,
  presented: string | null,
): Promise<boolean> {
  if (presented === null || presented.length === 0) return false;
  const expected = await csrfTokenFor(secret, sessionToken);
  return timingSafeEqual(expected, presented);
}

/** same-origin 검사. Origin 헤더와 Fetch Metadata를 함께 본다. */
export function isSameOriginRequest(request: Request, allowedOrigins: readonly string[]): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false;
  const origin = request.headers.get('Origin');
  if (origin === null) {
    // Origin이 없는 요청은 GET/HEAD에서만 허용한다.
    return request.method === 'GET' || request.method === 'HEAD';
  }
  return allowedOrigins.includes(origin);
}
