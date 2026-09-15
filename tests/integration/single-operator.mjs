#!/usr/bin/env node
/**
 * 담당자 한 명이 전 과정을 끝낼 수 있는지 검증한다.
 * 타인 승인, 역할 분리, 점수·가중치, 권리 확인, 선정 근거가 없어야 한다.
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
function note(text) {
  results.push(`      ${text}`);
}

const jar = new Map();
let csrf = null;
async function admin(path, { method = 'GET', body, subject = OPERATOR, email } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: ADMIN_URL,
    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (subject !== null) headers['X-Dev-Access-Subject'] = subject;
  if (email !== undefined) headers['X-Dev-Access-Email'] = email;
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
  const session = await fetch(`${PUBLIC_URL}/api/submission-session`, { method: 'POST', headers: { Origin: PUBLIC_URL } });
  for (const raw of session.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const token = (await session.json()).csrfToken;
  const campaign = await (await fetch(`${PUBLIC_URL}/api/campaign`)).json();
  const response = await fetch(`${PUBLIC_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: PUBLIC_URL,
      'X-CSRF-Token': token,
      'Idempotency-Key': randomUUID(),
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
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

// --- 로그인 ---
const me = await admin('/api/admin/me');
check('회사 계정 로그인 200', me.status, 200);
csrf = me.body.csrfToken;
check('회사 도메인 계정', me.body.email.endsWith('@seoularena.net'), true);
check('인증 없이 접근 401', (await admin('/api/admin/dashboard', { subject: null })).status, 401);
check('외부 도메인 거절', (await admin('/api/admin/me', { subject: 'outsider', email: 'x@gmail.com' })).status, 403);
check('유사 도메인 거절', (await admin('/api/admin/me', { subject: 'x', email: 'a@seoularena.net.evil.com' })).status, 403);

// --- 화면 문구 직접 저장 ---
const editor = await admin('/api/admin/content?page=SUBMISSION');
check('문구 편집기 조회 200', editor.status, 200);
check('초안 생성 없이 현재 내용 표시', editor.body.fields.length > 0, true);
const heroField = editor.body.fields.find((f) => f.key === 'hero');
const saved = await admin('/api/admin/content/field', {
  method: 'PUT',
  body: { page: 'SUBMISSION', key: 'hero', text: 'FIRST SEAT', expectedVersion: editor.body.expectedVersion },
});
check('항목 저장 200', saved.status, 200);
check('저장 후 버전 증가', saved.body.version > editor.body.version, true);
const staleSave = await admin('/api/admin/content/field', {
  method: 'PUT',
  body: { page: 'SUBMISSION', key: 'hero', text: '충돌', expectedVersion: editor.body.expectedVersion },
});
check('오래된 버전으로 저장 시 충돌 409', staleSave.status, 409);
void heroField;

const publicCampaign = await (await fetch(`${PUBLIC_URL}/api/campaign`)).json();
check('저장 내용이 공개 화면에 반영', publicCampaign.content.blocks.find((b) => b.key === 'hero').text, 'FIRST SEAT');

// --- 응모와 심사 ---
for (const message of ['첫 좌석에 남기는 마음', '무대보다 먼저 도착한 밤', '오늘 여기서 시작합니다']) {
  check(`접수 201 (${message})`, await submit(message), 201);
}
const list = await admin('/api/admin/submissions?limit=50');
check('심사 목록 조회', list.body.rows.length >= 3, true);
check('후보 집계 필드 존재', typeof list.body.counts.candidate, 'number');

// 검토 대기에서 바로 후보로
const first = list.body.rows[0];
const toCandidate = await admin(`/api/admin/submissions/${first.id}`, {
  method: 'PATCH',
  body: { status: 'CANDIDATE', expectedRowVersion: first.rowVersion },
});
check('검토 대기에서 바로 후보 지정', toCandidate.status, 200);
check('메모 없이도 상태 변경 가능', toCandidate.status, 200);

const second = list.body.rows[1];
await admin(`/api/admin/submissions/${second.id}`, {
  method: 'PATCH',
  body: { status: 'CANDIDATE', expectedRowVersion: second.rowVersion },
});

// --- 숏리스트 자동 구성 ---
const shortlist = await admin('/api/admin/shortlist');
check('후보가 숏리스트에 자동 표시', shortlist.body.prepared.length, 2);
check('권리 확인 항목 없음', /rightsConfirmed/.test(JSON.stringify(shortlist.body)), false);

const confirmed = await admin('/api/admin/shortlist/confirm', {
  method: 'POST',
  body: { expectedPreparedDigest: shortlist.body.preparedDigest },
});
check('후보 확정 200', confirmed.status, 200);
check('확정 목록 2개', confirmed.body.confirmed.length, 2);

// 후보를 하나 빼면 다시 확정이 필요하다
const refreshed = await admin('/api/admin/submissions?limit=50');
const removed = refreshed.body.rows.find((r) => r.id === second.id);
await admin(`/api/admin/submissions/${second.id}`, {
  method: 'PATCH',
  body: { status: 'APPROVED', expectedRowVersion: removed.rowVersion },
});
const afterRemove = await admin('/api/admin/shortlist');
check('후보 해제 시 준비 목록에서 제거', afterRemove.body.prepared.length, 1);
check('확정본이 낡은 상태로 표시', afterRemove.body.stale, true);
await admin('/api/admin/shortlist/confirm', {
  method: 'POST',
  body: { expectedPreparedDigest: afterRemove.body.preparedDigest },
});

// --- 공모 중에도 한 번에 투표 전환 ---
const dashboard = await admin('/api/admin/dashboard');
check('공모 진행 중 다음 작업은 투표 시작', dashboard.body.nextAction, 'OPEN_VOTING');
check('전환 조건 충족', dashboard.body.nextActionPreview.allowed, true);
check('확인창에 후보 목록 제공', dashboard.body.nextActionPreview.confirmList.length, 1);
check('접수 종료도 함께 처리 안내', dashboard.body.nextActionPreview.summary.some((s) => s.label === '함께 처리'), true);

const openVoting = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'OPEN_VOTING',
    idempotencyKey: randomUUID(),
    expectedRevision: dashboard.body.campaignRevision,
    expectedSnapshotDigest: dashboard.body.nextActionPreview.snapshotDigest,
  },
});
check('본인 확인 한 번으로 투표 시작', openVoting.status, 200);
check('한 번에 투표 공개까지', openVoting.body.state, 'VOTING_OPEN');
check('투표 중 접수 거절', await submit('마감 후 문구'), 409);

// 투표 중에는 후보를 바꿀 수 없다
const lockedList = await admin('/api/admin/submissions?limit=50');
const lockedRow = lockedList.body.rows.find((r) => r.id === first.id);
const lockedChange = await admin(`/api/admin/submissions/${first.id}`, {
  method: 'PATCH',
  body: { status: 'APPROVED', expectedRowVersion: lockedRow.rowVersion },
});
check('투표 중 후보 변경 차단', lockedChange.status, 409);

// --- 투표 현황 ---
const ranking = await admin('/api/admin/vote-ranking');
check('득표순 조회 200', ranking.status, 200);
check('0표 후보도 표시', ranking.body.rows.length >= 1, true);
check('가중 점수 없음', /score|weight|bps/i.test(JSON.stringify(ranking.body)), false);

// --- 최종 문구 선정 ---
const pick = ranking.body.rows[0];
const currentSelection = (await admin('/api/admin/final-message')).body;
const finalConfirm = await admin('/api/admin/final-message', {
  method: 'POST',
  body: { candidateId: pick.candidateId, expectedCurrentResultId: currentSelection?.resultId ?? '' },
});
check('점수 없이 최종 문구 확정', finalConfirm.status, 200);
check('확정 문구 일치', finalConfirm.body.message, pick.message);

// --- 결과 공개 ---
const beforePublish = await admin('/api/admin/dashboard');
check('투표 중에도 결과 전환 가능', beforePublish.body.nextAction, 'PUBLISH_RESULT');
const publish = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'PUBLISH_RESULT',
    idempotencyKey: randomUUID(),
    expectedRevision: beforePublish.body.campaignRevision,
    expectedSnapshotDigest: beforePublish.body.nextActionPreview.snapshotDigest,
  },
});
check('본인 확인 한 번으로 결과 공개', publish.status, 200);
check('한 번에 결과 공개까지', publish.body.state, 'RESULT_PUBLISHED');

const publicResult = await (await fetch(`${PUBLIC_URL}/api/result`)).json();
check('공개 결과에 선정 문구', publicResult.winnerMessage, pick.message);
check('공개 결과에 선정 근거 없음', 'rationale' in publicResult, false);

// 공개 후 변경
const rankingAfter = await admin('/api/admin/vote-ranking');
if (rankingAfter.body.rows.length > 1) {
  const other = rankingAfter.body.rows[1];
  const beforeChange = (await admin('/api/admin/final-message')).body;
  const changed = await admin('/api/admin/final-message', {
    method: 'POST',
    body: { candidateId: other.candidateId, expectedCurrentResultId: beforeChange?.resultId ?? '' },
  });
  check('공개 후 최종 문구 변경 가능', changed.status, 200);
  const changedPublic = await (await fetch(`${PUBLIC_URL}/api/result`)).json();
  check('공개 결과도 함께 변경', changedPublic.winnerMessage, other.message);
} else {
  note('후보가 1개라 공개 후 변경은 확인하지 않음');
}

// --- 옛 경로 차단 ---
check('옛 전환 경로 차단', (await admin('/api/admin/transitions/commit', { method: 'POST', body: {} })).status, 409);
check('옛 점수 경로 차단', (await admin('/api/admin/jury-scores', { method: 'PUT', body: {} })).status, 409);
check('옛 후보 묶음 경로 차단', (await admin('/api/admin/candidate-sets', { method: 'POST', body: {} })).status, 409);

// --- 개인정보 ---
const mask = await admin(`/api/admin/submissions/${first.id}/mask`);
check('가려진 정보 조회 200', mask.status, 200);
check('가려진 형태로 표시', mask.body.maskedEmail.includes('*'), true);
const reveal = await admin(`/api/admin/submissions/${first.id}/reveal`, {
  method: 'POST',
  body: { reason: '당첨 안내 확인' },
});
check('같은 세션에서 원문 열람', reveal.status, 200);
check('원문 복호화 성공', reveal.body.email, 't@example.com');

const audit = await admin('/api/admin/audit?limit=100');
const actions = new Set(audit.body.rows.map((r) => r.action));
check('열람 기록 자동 저장', actions.has('PII_REVEALED'), true);
check('문구 저장 기록', actions.has('CONTENT_FIELD_SAVED'), true);
check('후보 확정 기록', actions.has('SHORTLIST_CONFIRMED'), true);
check('최종 문구 기록', actions.has('FINAL_MESSAGE_CONFIRMED'), true);
check('기록에 개인정보 없음', /t@example\.com|01012345678/.test(JSON.stringify(audit.body)), false);

console.log(results.join('\n'));
const passed = results.filter((r) => r.startsWith('PASS')).length;
const total = results.filter((r) => r.startsWith('PASS') || r.startsWith('FAIL')).length;
console.log(`\n${passed}/${total} 통과`);
process.exit(failures === 0 ? 0 : 1);
