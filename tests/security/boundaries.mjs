#!/usr/bin/env node
/**
 * 권한·경계 보안 테스트.
 * 인증, 회사 도메인, CSRF, 교차 출처, 사용 중단 경로, Public API 위생을 확인한다.
 */

import { resetFixture } from '../lib/fixture.mjs';

// 앞 테스트가 남긴 단계를 물려받지 않도록 각 테스트가 스스로 가상 데이터를 초기화한다.
resetFixture();

const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:8788';
const OPERATOR = 'dev-operator';

const results = [];
let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} (기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)})`);
}

const jar = new Map();
let csrfToken = null;

async function adminFetch(subject, path, { method = 'GET', body, csrf = true, origin = ADMIN_URL, email } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: origin,
    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (subject !== null) headers['X-Dev-Access-Subject'] = subject;
  if (email !== undefined) headers['X-Dev-Access-Email'] = email;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(ADMIN_URL + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

const me = await adminFetch(OPERATOR, '/api/admin/me');
csrfToken = me.body?.csrfToken ?? null;
check('회사 계정 로그인 200', me.status, 200);

// --- 인증 ---
check('인증 헤더 없이 401', (await adminFetch(null, '/api/admin/dashboard')).status, 401);
check('등록되지 않은 계정 403', (await adminFetch('unknown-subject', '/api/admin/me')).status, 403);
check('외부 도메인 거절', (await adminFetch('outsider', '/api/admin/me', { email: 'x@gmail.com' })).status, 403);
check('유사 도메인 거절', (await adminFetch('x', '/api/admin/me', { email: 'a@seoularena.net.evil.com' })).status, 403);

// --- CSRF·출처 ---
const list = await adminFetch(OPERATOR, '/api/admin/submissions');
const anyId = list.body?.rows?.[0]?.id ?? '00000000-0000-4000-8000-000000000000';
check(
  'CSRF 헤더 없는 변경 403',
  (
    await adminFetch(OPERATOR, `/api/admin/submissions/${anyId}`, {
      method: 'PATCH',
      body: { status: 'APPROVED', expectedRowVersion: 1 },
      csrf: false,
    })
  ).status,
  403,
);
check(
  '다른 출처의 변경 403',
  (
    await adminFetch(OPERATOR, `/api/admin/submissions/${anyId}`, {
      method: 'PATCH',
      body: { status: 'APPROVED', expectedRowVersion: 1 },
      origin: 'https://evil.example',
    })
  ).status,
  403,
);

// --- 사용 중단 경로 ---
check('옛 전환 경로 차단', (await adminFetch(OPERATOR, '/api/admin/transitions/commit', { method: 'POST', body: {} })).status, 409);
check('옛 점수 경로 차단', (await adminFetch(OPERATOR, '/api/admin/jury-scores', { method: 'PUT', body: {} })).status, 409);
check('옛 결과 산출 경로 차단', (await adminFetch(OPERATOR, '/api/admin/results', { method: 'POST', body: {} })).status, 409);
check('옛 후보 묶음 경로 차단', (await adminFetch(OPERATOR, '/api/admin/candidate-sets', { method: 'POST', body: {} })).status, 409);

// --- Public host로 Admin 접근 ---
check(
  'Public host의 admin 경로 404',
  (await fetch(`${PUBLIC_URL}/api/admin/me`, { headers: { 'X-Dev-Access-Subject': OPERATOR } })).status,
  404,
);
check('Public host의 admin 목록 404', (await fetch(`${PUBLIC_URL}/api/admin/submissions`)).status, 404);

// --- Public API 위생 ---
const campaign = await (await fetch(`${PUBLIC_URL}/api/campaign`)).json();
check('공개 DTO에 내부 필드 없음', /internalNotes|reviewer_note|maker_id/.test(JSON.stringify(campaign)), false);
const headers = (await fetch(`${PUBLIC_URL}/api/campaign`)).headers;
check('공개 API는 no-store', headers.get('cache-control'), 'no-store');
check('nosniff 헤더', headers.get('x-content-type-options'), 'nosniff');

// --- 배포 분리: 화면은 Vercel, API는 Cloudflare ---
// Worker는 정적 파일을 서빙하지 않는다. 브라우저가 직접 열 화면이 없다.
const rootPage = await fetch(`${PUBLIC_URL}/`, { headers: { Accept: 'text/html' } });
check('참여자 Worker 루트는 화면을 주지 않음', rootPage.status, 404);
check('참여자 Worker 루트는 JSON', rootPage.headers.get('content-type'), 'application/json; charset=utf-8');
// 운영 Worker는 인증을 먼저 하므로 인증 없는 요청에는 경로조차 구분해 알려주지 않는다.
check('운영 Worker는 인증 없이 아무 것도 주지 않음', (await fetch(`${ADMIN_URL}/`)).status, 401);

// 회사 계정 로그인은 Vercel이 맡는다. Worker에는 로그인 경로가 없다.
check(
  'Worker에 로그인 경로 없음',
  (await adminFetch(OPERATOR, '/api/admin/login')).status,
  404,
);

// 브라우저가 신원 헤더를 직접 넣어도 운영자로 인정하지 않는다.
const forgedIdentity = await fetch(`${ADMIN_URL}/api/admin/dashboard`, {
  headers: {
    Origin: ADMIN_URL,
    'X-FS-Identity': btoa(JSON.stringify({ provider: 'google', subject: 'intruder', email: 'x@seoularena.net' })),
  },
});
check('위조한 신원 헤더 거절', forgedIdentity.status === 401 || forgedIdentity.status === 403, true);

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} 통과`);
process.exit(failures === 0 ? 0 : 1);
