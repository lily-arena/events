import {describe,it,expect,vi,afterEach} from 'vitest';
import {handleGateway,type GatewayEnv} from '../../packages/relay/src/events';
import {createSessionValue} from '../../packages/relay/src/google';
const env:GatewayEnv={PUBLIC_ORIGIN:'https://events.seoularena.net',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',SESSION_SECRET:'test-session-key',GATEWAY_SECRET:'test-gateway-key',ADMIN_WORKER_URL:'https://admin.example.workers.dev',PUBLIC_WORKER_URL:'https://public.example.workers.dev'};
afterEach(()=>vi.unstubAllGlobals());
describe('single-origin company login boundary',()=>{
 it('denies admin access without a signed login and blocks cross-site mutations',async()=>{
  expect((await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/admin/events'),env)).status).toBe(401);
  expect((await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/admin/events',{method:'POST',headers:{origin:'https://other.example'},body:'{}'}),env)).status).toBe(403);
 });
 it('allows public reads without Google login and removes client identity spoofing',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
  expect((await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/events/first-seat',{headers:{cookie:'private-cookie','X-Dev-Access-Subject':'attacker'}}),env)).status).toBe(200);
  const options=fetcher.mock.calls[0]![1] as RequestInit;
  const headers=new Headers(options.headers);expect(headers.has('cookie')).toBe(false);expect(headers.has('X-Dev-Access-Subject')).toBe(false);
 });
 it('uses one callback and a scoped HttpOnly Secure login-flow cookie',async()=>{
  const response=await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/admin/auth/login'),env);
  const url=new URL(response.headers.get('location')!);expect(url.searchParams.get('redirect_uri')).toBe(env.PUBLIC_ORIGIN+'/api/admin/auth/callback');expect(url.searchParams.get('hd')).toBe('seoularena.net');
  const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('Path=/api/admin');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');
 });
 it('rejects forged callback state and local identities in deployment',async()=>{
  expect((await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/admin/auth/callback?state=fake&code=fake'),env)).status).toBe(401);
  const value=await createSessionValue(env.SESSION_SECRET,{provider:'local',subject:'test',email:'test@seoularena.net'},100);
  expect((await handleGateway(new Request(env.PUBLIC_ORIGIN+'/api/admin/events',{headers:{cookie:'__Secure-arena-events-admin='+value}}),env)).status).toBe(401);
 });
});
