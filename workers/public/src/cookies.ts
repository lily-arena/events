/**
 * production에서는 __Host- prefix + Secure를 쓴다.
 * 로컬 http 개발에서는 브라우저가 Secure cookie를 거부할 수 있어 prefix 없는 이름을 쓴다.
 */
export interface CookieNames {
  readonly submit: string;
  readonly receipt: string;
  readonly voter: string;
}

export function cookieNames(environment: string): CookieNames {
  return environment === 'production'
    ? { submit: '__Host-fs-submit', receipt: '__Host-fs-receipt', voter: '__Host-fs-voter' }
    : { submit: 'fs-submit', receipt: 'fs-receipt', voter: 'fs-voter' };
}

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

export function setCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  environment: string,
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (environment === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

export function clearCookie(name: string, environment: string): string {
  return setCookie(name, '', 0, environment);
}
