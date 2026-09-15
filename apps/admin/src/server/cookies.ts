/**
 * 운영 화면 서버 쪽 쿠키.
 * production은 https이므로 `__Host-` 접두사와 Secure를 쓴다.
 */
export const ADMIN_SESSION_COOKIE = '__Host-fs-admin-session';
export const ADMIN_OAUTH_COOKIE = '__Host-fs-admin-oauth';

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    if (rawKey === undefined) continue;
    if (rawKey.trim() === name) return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function clearCookie(name: string): string {
  return setCookie(name, '', 0);
}
