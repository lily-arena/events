import { afterEach, describe, expect, it, vi } from 'vitest';
import admin from '../../apps/admin/api/relay.js';
import publicApi from '../../apps/public/api/relay.js';
import auth from '../../apps/admin/api/auth-handler.js';
import { verifyGatewayRequest } from '../../packages/security/src/gateway.js';

const secret = 'test-only-gateway-secret-not-production';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Vercel runtime boundaries', () => {
  it('missing company OAuth is a useful 503, not a redirect loop', async () => {
    vi.stubEnv('GATEWAY_SECRET', secret);
    vi.stubEnv('ADMIN_API_URL', 'https://admin.example.workers.dev');
    vi.stubEnv('SESSION_SECRET', secret);
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const response = await admin(new Request('https://admin.example.com/api/admin/me'));
    expect(response.status).toBe(503);
    expect((await response.json()).message).toContain('회사 계정 로그인 설정');
  });

  it('configured Admin still denies unauthenticated nested API requests', async () => {
    for (const key of ['GATEWAY_SECRET', 'SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) vi.stubEnv(key, secret);
    vi.stubEnv('ADMIN_API_URL', 'https://admin.example.workers.dev');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await admin(new Request('https://admin.example.com/api/admin/votes/monitor'));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('OAuth login redirects to Google with the custom-domain callback', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', secret);
    vi.stubEnv('SESSION_SECRET', secret);
    const response = await auth(new Request('https://firstseat-admin.seoularena.net/api/auth/login?redirect=%2Fdashboard'));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://firstseat-admin.seoularena.net/api/auth/callback');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
  });

  it('OAuth entry fails closed on empty configuration', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', ''); vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect((await auth(new Request('https://admin.example.com/api/auth/login'))).status).toBe(503);
  });

  it('relays original path/query/body and signed identity boundaries; never caches cookies', async () => {
    vi.stubEnv('GATEWAY_SECRET', secret);
    vi.stubEnv('PUBLIC_API_URL', 'https://public.example.workers.dev');
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://public.example.workers.dev/api/nested/path?locale=ko');
      expect(init.body).toBe('{"message":"test"}');
      const verification = await verifyGatewayRequest(secret, new Request(url, init), String(init.body));
      expect(verification.ok).toBe(true);
      expect(verification.identity).toBeNull();
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' });
      headers.append('Set-Cookie', 'one=1; Path=/; HttpOnly; Secure');
      headers.append('Set-Cookie', 'two=2; Path=/; HttpOnly; Secure');
      return new Response('{"ok":true}', {headers});
    });
    vi.stubGlobal('fetch', fetch);
    const response = await publicApi(new Request('https://public.example.com/api/nested/path?locale=ko', {
      method:'POST', headers:{ 'X-FS-Identity':'forged', Origin:'https://public.example.com' }, body:'{"message":"test"}',
    }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('upstream failures become a JSON 502', async () => {
    vi.stubEnv('GATEWAY_SECRET', secret); vi.stubEnv('PUBLIC_API_URL', 'https://public.example.workers.dev');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response = await publicApi(new Request('https://public.example.com/api/campaign'));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('UNAVAILABLE');
  });
});
