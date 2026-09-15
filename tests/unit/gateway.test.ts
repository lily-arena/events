import { describe, expect, it } from 'vitest';
import { signGatewayRequest, verifyGatewayRequest } from '../../packages/security/src/gateway.js';

/**
 * 중계 서버와 Cloudflare 사이의 요청 서명.
 * 이 서명이 뚫리면 누구나 운영자 행세를 할 수 있으므로 위조 시도를 하나씩 확인한다.
 */

const SECRET = 'test-gateway-secret-value-0123456789';
const IDENTITY = { provider: 'google', subject: '10987', email: 'operator@seoularena.net' };

async function signedRequest(
  overrides: {
    method?: string;
    url?: string;
    body?: string;
    identity?: typeof IDENTITY | null;
    clientIp?: string;
    now?: number;
  } = {},
) {
  const method = overrides.method ?? 'POST';
  const url = overrides.url ?? 'https://api.example.workers.dev/api/admin/dashboard';
  const body = overrides.body ?? '{"a":1}';
  const headers = await signGatewayRequest(SECRET, {
    method,
    path: new URL(url).pathname,
    body,
    identity: overrides.identity === undefined ? IDENTITY : overrides.identity,
    clientIp: overrides.clientIp ?? '203.0.113.7',
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });
  return { request: new Request(url, { method, headers }), body };
}

describe('서버 간 요청 서명', () => {
  it('제대로 서명한 요청은 통과하고 신원과 IP를 돌려준다', async () => {
    const { request, body } = await signedRequest();
    const result = await verifyGatewayRequest(SECRET, request, body);
    expect(result.ok).toBe(true);
    expect(result.identity?.subject).toBe('10987');
    expect(result.clientIp).toBe('203.0.113.7');
  });

  it('서명이 없으면 거절한다', async () => {
    const request = new Request('https://api.example.workers.dev/api/admin/dashboard', { method: 'POST' });
    const result = await verifyGatewayRequest(SECRET, request, '{"a":1}');
    expect(result.ok).toBe(false);
  });

  it('다른 비밀값으로 만든 서명은 거절한다', async () => {
    const { request, body } = await signedRequest();
    const result = await verifyGatewayRequest('다른-비밀값', request, body);
    expect(result.ok).toBe(false);
  });

  it('본문을 바꾸면 거절한다', async () => {
    const { request } = await signedRequest({ body: '{"amount":1}' });
    const result = await verifyGatewayRequest(SECRET, request, '{"amount":9999}');
    expect(result.ok).toBe(false);
  });

  it('경로를 바꾸면 거절한다', async () => {
    const { request, body } = await signedRequest({ url: 'https://api.example.workers.dev/api/admin/dashboard' });
    const moved = new Request('https://api.example.workers.dev/api/admin/deletions', {
      method: request.method,
      headers: request.headers,
    });
    const result = await verifyGatewayRequest(SECRET, moved, body);
    expect(result.ok).toBe(false);
  });

  it('메서드를 바꾸면 거절한다', async () => {
    const { request, body } = await signedRequest({ method: 'GET', body: '' });
    const changed = new Request(request.url, { method: 'POST', headers: request.headers, body });
    const result = await verifyGatewayRequest(SECRET, changed, body);
    expect(result.ok).toBe(false);
  });

  it('신원만 바꿔치기하면 거절한다', async () => {
    const { request, body } = await signedRequest();
    const headers = new Headers(request.headers);
    headers.set(
      'X-FS-Identity',
      btoa(JSON.stringify({ provider: 'google', subject: 'intruder', email: 'x@seoularena.net' })),
    );
    const forged = new Request(request.url, { method: request.method, headers });
    const result = await verifyGatewayRequest(SECRET, forged, body);
    expect(result.ok).toBe(false);
  });

  it('접속 IP만 바꿔치기하면 거절한다', async () => {
    const { request, body } = await signedRequest();
    const headers = new Headers(request.headers);
    headers.set('X-FS-Client-Ip', '198.51.100.9');
    const forged = new Request(request.url, { method: request.method, headers });
    const result = await verifyGatewayRequest(SECRET, forged, body);
    expect(result.ok).toBe(false);
  });

  it('오래된 요청은 다시 쓸 수 없다', async () => {
    const now = Date.now();
    const { request, body } = await signedRequest({ now: now - 10 * 60 * 1000 });
    const result = await verifyGatewayRequest(SECRET, request, body, now);
    expect(result.ok).toBe(false);
  });

  it('신원 없이 서명한 공개 API 요청은 신원이 비어 있다', async () => {
    const { request, body } = await signedRequest({ identity: null });
    const result = await verifyGatewayRequest(SECRET, request, body);
    expect(result.ok).toBe(true);
    expect(result.identity).toBeNull();
  });
});
