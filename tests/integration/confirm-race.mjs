#!/usr/bin/env node
/**
 * 확인창 경쟁 회귀 테스트.
 *
 * 운영자가 확인창에서 본 내용과 실제로 공개되는 내용이 어긋나면 안 된다.
 * 검수 R05의 재현 절차를 그대로 자동화한다.
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

// --- 후보 2개를 준비하고 투표를 연다 ---
await submit('첫 좌석에 남기는 마음');
await submit('무대보다 먼저 도착한 밤');

const list = await admin('/api/admin/submissions?limit=50');
for (const row of list.body.rows) {
  await admin(`/api/admin/submissions/${row.id}`, {
    method: 'PATCH',
    body: { status: 'CANDIDATE', expectedRowVersion: row.rowVersion },
  });
}

// --- 숏리스트: 낡은 지문으로는 확정되지 않는다 ---
const seen = (await admin('/api/admin/shortlist')).body;
check('준비 목록 지문 제공', typeof seen.preparedDigest === 'string' && seen.preparedDigest.length > 0, true);

const staleShortlist = await admin('/api/admin/shortlist/confirm', {
  method: 'POST',
  body: { expectedPreparedDigest: 'stale-digest-value' },
});
check('본 목록과 다르면 후보 확정 거절', staleShortlist.status, 409);

const confirmed = await admin('/api/admin/shortlist/confirm', {
  method: 'POST',
  body: { expectedPreparedDigest: seen.preparedDigest },
});
check('본 목록 그대로면 후보 확정', confirmed.status, 200);

const openView = (await admin('/api/admin/dashboard')).body;
const opened = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'OPEN_VOTING',
    idempotencyKey: randomUUID(),
    expectedRevision: openView.campaignRevision,
    expectedSnapshotDigest: openView.nextActionPreview.snapshotDigest,
  },
});
check('투표 시작', opened.body.state, 'VOTING_OPEN');

// --- 최종 문구 A 확정 → 확인창을 띄운 상태로 둔다 ---
const ranking = (await admin('/api/admin/vote-ranking')).body;
const candidateA = ranking.rows[0];
const candidateB = ranking.rows[1];

const selectionA = await admin('/api/admin/final-message', {
  method: 'POST',
  body: { candidateId: candidateA.candidateId, expectedCurrentResultId: '' },
});
check('최종 문구 A 확정', selectionA.status, 200);

// 운영자가 결과 공개 확인창을 띄운 시점의 화면 상태
const confirmScreen = (await admin('/api/admin/dashboard')).body;
check('확인창에 A가 보임', confirmScreen.nextActionPreview.confirmList[0], candidateA.message);
const digestSeenByOperator = confirmScreen.nextActionPreview.snapshotDigest;
const revisionSeenByOperator = confirmScreen.campaignRevision;

// --- 다른 창에서 최종 문구를 B로 바꾼다 ---
const selectionB = await admin('/api/admin/final-message', {
  method: 'POST',
  body: { candidateId: candidateB.candidateId, expectedCurrentResultId: selectionA.body.resultId },
});
check('다른 창에서 최종 문구 B로 변경', selectionB.status, 200);

// 같은 기대값으로 한 번 더 확정하면 낡은 요청이므로 거절해야 한다(중복 클릭)
const duplicate = await admin('/api/admin/final-message', {
  method: 'POST',
  body: { candidateId: candidateB.candidateId, expectedCurrentResultId: selectionA.body.resultId },
});
check('낡은 기대값의 중복 확정 거절', duplicate.status, 409);

// --- 운영자가 A를 보고 누른 확인은 실행되면 안 된다 ---
const staleExecute = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'PUBLISH_RESULT',
    idempotencyKey: randomUUID(),
    expectedRevision: revisionSeenByOperator,
    expectedSnapshotDigest: digestSeenByOperator,
  },
});
check('확인창과 다른 내용이면 결과 공개 거절', staleExecute.status, 409);

const stillHidden = await fetch(`${PUBLIC_URL}/api/result`);
check('거절되었으므로 결과는 아직 비공개', stillHidden.status >= 400, true);

// --- 다시 확인하면 B가 보이고, 그때 공개하면 B가 공개된다 ---
const reconfirm = (await admin('/api/admin/dashboard')).body;
check('다시 연 확인창에는 B가 보임', reconfirm.nextActionPreview.confirmList[0], candidateB.message);

const published = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'PUBLISH_RESULT',
    idempotencyKey: randomUUID(),
    expectedRevision: reconfirm.campaignRevision,
    expectedSnapshotDigest: reconfirm.nextActionPreview.snapshotDigest,
  },
});
check('다시 확인한 뒤에는 공개됨', published.status, 200);

const publicResult = await (await fetch(`${PUBLIC_URL}/api/result`)).json();
check('공개된 문구는 확인창에서 본 B', publicResult.winnerMessage, candidateB.message);

// --- 확인 지문을 아예 빼면 거절한다 ---
const archiveView = (await admin('/api/admin/dashboard')).body;
const noDigest = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'ARCHIVE',
    idempotencyKey: randomUUID(),
    expectedRevision: archiveView.campaignRevision,
  },
});
check('확인 지문 없는 전환 거절', noDigest.status, 400);

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} 통과`);
process.exit(failures === 0 ? 0 : 1);
