import { DomainError, STATUS_FOR_CODE, type ErrorBody, type ErrorCode } from '@first-seat/domain';

/** 모든 API 응답은 no-store. 개인정보·문구를 캐시하거나 prefetch하지 않는다. */
export function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  fieldErrors: readonly { field: string; message: string }[] = [],
  extraHeaders: HeadersInit = {},
): Response {
  const body: ErrorBody = fieldErrors.length > 0
    ? { code, message, requestId, fieldErrors }
    : { code, message, requestId };
  return jsonResponse(body, STATUS_FOR_CODE[code], extraHeaders);
}

export function domainErrorResponse(error: DomainError, requestId: string): Response {
  return errorResponse(error.code, error.message, requestId, error.fieldErrors);
}

export const MAX_BODY_BYTES = 16 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new DomainError('BAD_REQUEST', '요청 본문이 너무 큽니다.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new DomainError('BAD_REQUEST', '요청 본문이 너무 큽니다.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
}
