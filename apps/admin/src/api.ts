import type { ErrorBody } from '@first-seat/domain';

/**
 * Admin API client.
 * 개인정보 원문은 화면 메모리에만 두고 저장소·URL에 남기지 않는다.
 *
 * 브라우저는 언제나 이 화면 주소의 /api만 부른다.
 * 회사 계정 로그인(Google Workspace)도 같은 호스트의 /api/auth에서 처리한다.
 */

/** 같은 출처 API 경로. 다른 호스트를 부르지 않는다. */
export function apiUrl(path: string): string {
  return path;
}

/** 로컬 개발에서는 헤더로 담당자를 지정하므로 Access 로그인으로 보내지 않는다. */
const IS_LOCAL_DEV =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/**
 * 로그인 화면으로 보낸다.
 *
 * 통신 오류나 서버 장애를 로그인 문제로 착각해 계속 보내면 로그인 반복만 생긴다.
 * 그래서 서버가 401로 분명히 알려준 경우에만 부르고, 한 번 보낸 뒤에는 다시 보내지 않는다.
 */
let loginRedirected = false;

export function goToLogin(): void {
  if (IS_LOCAL_DEV || typeof window === 'undefined') return;
  if (loginRedirected) return;
  // 인증 거절/취소 후 자동 로그인으로 되돌아가는 무한 반복을 막는다.
  if (new URLSearchParams(window.location.search).has('login')) return;
  loginRedirected = true;
  const back = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/api/auth/login?redirect=${back}`);
}

/** 응답 본문을 해석한다. JSON이 아니면(로그인 HTML·프록시 오류 페이지 등) 원래 오류를 감추지 않는다. */
function parseBody(text: string, contentType: string | null): unknown {
  if (text.length === 0) return null;
  if (contentType !== null && !contentType.includes('json')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 로컬 개발에서만 쓰는 담당자 식별값.
 * 실제 운영에서는 Cloudflare Access가 확인한 회사 계정이 신원을 결정하며 이 헤더는 무시된다.
 */
const DEV_SUBJECT = 'dev-operator';

export function devSubject(): string {
  return DEV_SUBJECT;
}

let csrfToken: string | null = null;

export function resetCsrf(): void {
  csrfToken = null;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  // 로컬 개발에서만 담당자 헤더를 붙인다.
  if (IS_LOCAL_DEV) {
    headers['X-Dev-Access-Subject'] = devSubject();
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: 'same-origin',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    // 네트워크 오류다. 로그인 만료와 구분한다. 여기서 로그인으로 보내면 장애 때 로그인만 반복된다.
    throw new ApiError(0, {
      code: 'UNAVAILABLE',
      message: '서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.',
      requestId: '',
    });
  }
  const text = await response.text();
  const data = parseBody(text, response.headers.get('Content-Type'));
  if (!response.ok) {
    const body =
      data !== null && typeof data === 'object'
        ? (data as ErrorBody)
        : {
            code: 'UNAVAILABLE' as const,
            message:
              response.status >= 500
                ? '서버에 문제가 있습니다. 잠시 후 다시 시도해주세요.'
                : '요청을 처리하지 못했습니다.',
            requestId: '',
          };
    // 서버가 인증이 필요하다고 분명히 알려준 경우에만 로그인으로 보낸다.
    if (response.status === 401) {
      const loginFailure = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('login');
      if (loginFailure) {
        throw new ApiError(401, { code: 'UNAUTHENTICATED', message: '회사 계정 로그인을 완료하지 못했습니다. 주소의 ?login= 부분을 지우고 다시 접속해주세요.', requestId: '' });
      }
      goToLogin();
    }
    throw new ApiError(response.status, body);
  }
  if (data === undefined && text.length > 0) {
    // 200인데 JSON이 아니면 API가 아니라 다른 것이 응답한 것이다(예: SPA HTML).
    throw new ApiError(502, {
      code: 'UNAVAILABLE',
      message: 'API 응답 형식이 올바르지 않습니다. 배포 설정을 확인해주세요.',
      requestId: '',
    });
  }
  return data as T;
}

export interface Me {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly csrfToken: string;
}

export async function fetchMe(): Promise<Me> {
  const me = await request<Me>('/api/admin/me');
  csrfToken = me.csrfToken;
  return me;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
};
