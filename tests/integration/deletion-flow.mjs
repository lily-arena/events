#!/usr/bin/env node
/**
 * 파기 회귀 테스트.
 *
 * 원문을 열람한 적이 있는 응모도 끝까지 파기되는지 확인한다.
 * 열람 이력(reveal_grants)은 응모를 가리키는데 연쇄 삭제가 걸려 있지 않아
 * 먼저 정리하지 않으면 응모 삭제가 외래키 제약으로 실패한다.
 *
 * 연락처만 지우는 파기와 응모 전체 파기를 모두 확인한다.
 */
import { randomUUID } from 'node:crypto';
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
let csrf = null;

async function admin(path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: ADMIN_URL,
    'X-Dev-Access-Subject': OPERATOR,
    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf !== null) headers['X-CSRF-Token'] = csrf;
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

async function submit(message) {
  const cookies = new Map();
  const session = await fetch(`${PUBLIC_URL}/api/submission-session`, {
    method: 'POST',
    headers: { Origin: PUBLIC_URL },
  });
  for (const raw of session.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const { csrfToken } = await session.json();
  const cookieHeader = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const campaign = await (await fetch(`${PUBLIC_URL}/api/campaign`, { headers: { Cookie: cookieHeader } })).json();
  const response = await fetch(`${PUBLIC_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: PUBLIC_URL,
      'X-CSRF-Token': csrfToken,
      'Idempotency-Key': randomUUID(),
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      message,
      name: '홍길동',
      phone: '01012345678',
      email: 't@example.com',
      configRevision: campaign.revision,
      contentVersionId: campaign.content.versionId,
      consents: campaign.policies.filter((p) => p.required).map((p) => ({ policyId: p.id, accepted: true })),
      turnstileToken: 'mock-submission',
    }),
  });
  return response.status;
}

csrf = (await admin('/api/admin/me')).body.csrfToken;

check('연락처 파기용 응모 접수', await submit('연락처만 지울 문구'), 201);
check('전체 파기용 응모 접수', await submit('통째로 지울 문구'), 201);

const list = await admin('/api/admin/submissions?limit=50');
const [contactTarget, fullTarget] = list.body.rows;

// --- 원문을 열람해 열람 이력을 만든다 ---
const reveal = await admin(`/api/admin/submissions/${fullTarget.id}/reveal`, {
  method: 'POST',
  body: { reason: '파기 전 본인 확인' },
});
check('원문 열람 200', reveal.status, 200);

// --- 연락처만 파기 ---
const contactJob = await admin('/api/admin/deletions', {
  method: 'POST',
  body: { targetId: contactTarget.id, kind: 'CONTACT', reason: '보유기간 경과' },
});
check('연락처 파기 작업 등록', contactJob.status, 201);

// --- 열람 이력이 있는 응모를 통째로 파기 ---
const fullJob = await admin('/api/admin/deletions', {
  method: 'POST',
  body: { targetId: fullTarget.id, kind: 'SUBMISSION', reason: '삭제 요청' },
});
check('응모 전체 파기 작업 등록', fullJob.status, 201);

// --- 작업 실행 ---
const run = await admin('/api/admin/jobs/run', { method: 'POST' });
check('파기 작업 실행 200', run.status, 200);

const contactState = await admin(`/api/admin/deletions/${contactJob.body.id}`);
check('연락처 파기 완료', contactState.body.state, 'VERIFIED');

const fullState = await admin(`/api/admin/deletions/${fullJob.body.id}`);
check('열람 이력이 있어도 응모 전체 파기 완료', fullState.body.state, 'VERIFIED');

// --- 실제로 사라졌는지 ---
const after = await admin('/api/admin/submissions?limit=50');
const remainingIds = after.body.rows.map((r) => r.id);
check('파기한 응모는 목록에서 사라짐', remainingIds.includes(fullTarget.id), false);
check('연락처만 지운 응모는 남아 있음', remainingIds.includes(contactTarget.id), true);

// 파기한 연락처는 마스킹값도 남기지 않고 '파기됨'으로 표시한다.
const mask = await admin(`/api/admin/submissions/${contactTarget.id}/mask`);
check('연락처 파기 표시', mask.body.deleted, true);
check('마스킹값도 남지 않음', `${mask.body.maskedName}${mask.body.maskedPhone}${mask.body.maskedEmail}`, '');

const gone = await admin(`/api/admin/submissions/${fullTarget.id}`);
check('파기한 응모 상세 조회 불가', gone.status >= 400, true);

// --- 열람 기록 자체는 감사기록에 남는다 ---
const audit = await admin('/api/admin/audit?limit=200');
const actions = new Set(audit.body.rows.map((r) => r.action));
check('열람 사실은 감사기록에 남음', actions.has('PII_REVEALED'), true);
check('파기 완료도 감사기록에 남음', actions.has('DELETION_VERIFIED'), true);

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} 통과`);
process.exit(failures === 0 ? 0 : 1);
