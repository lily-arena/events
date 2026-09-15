#!/usr/bin/env node
/**
 * 투표 흐름 검증.
 * 마감 일정을 비워 둔 상태에서 투표가 되는지, 투표 후 완료 화면으로 이어지는지,
 * 같은 참여자가 다시 들어와도 완료 화면을 보는지 확인한다.
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

const adminJar = new Map();
let adminCsrf = null;
async function admin(path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: ADMIN_URL,
    'X-Dev-Access-Subject': OPERATOR,
    Cookie: [...adminJar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && adminCsrf !== null) headers['X-CSRF-Token'] = adminCsrf;
  const response = await fetch(ADMIN_URL + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    adminJar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

/** 참여자 한 명의 브라우저를 흉내 낸다. */
class Visitor {
  constructor() {
    this.jar = new Map();
    this.csrf = null;
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  capture(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async start() {
    const response = await fetch(`${PUBLIC_URL}/api/submission-session`, {
      method: 'POST',
      headers: { Origin: PUBLIC_URL, Cookie: this.header() },
    });
    this.capture(response);
    this.csrf = (await response.json()).csrfToken;
  }
  async get(path) {
    const response = await fetch(PUBLIC_URL + path, { headers: { Cookie: this.header() } });
    this.capture(response);
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  }
  async post(path, body) {
    const response = await fetch(PUBLIC_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: PUBLIC_URL,
        'X-CSRF-Token': this.csrf,
        'Idempotency-Key': randomUUID(),
        Cookie: this.header(),
      },
      body: JSON.stringify(body),
    });
    this.capture(response);
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  }
  async vote(candidateId, setId) {
    const session = await this.post('/api/voter-session', { turnstileToken: 'mock-voter_session' });
    if (session.status !== 201) {
      return { status: session.status, body: { ...session.body, stage: 'voter-session' } };
    }
    return this.post('/api/votes', { candidateId, setId, turnstileToken: 'mock-vote' });
  }
}

async function submit(message) {
  const visitor = new Visitor();
  await visitor.start();
  const campaign = (await visitor.get('/api/campaign')).body;
  const response = await visitor.post('/api/submissions', {
    message,
    name: '홍길동',
    phone: '01012345678',
    email: 't@example.com',
    configRevision: campaign.revision,
    contentVersionId: campaign.content.versionId,
    consents: campaign.policies.filter((p) => p.required).map((p) => ({ policyId: p.id, accepted: true })),
    turnstileToken: 'mock-submission',
  });
  return response.status;
}

adminCsrf = (await admin('/api/admin/me')).body.csrfToken;

// --- 마감 일정을 비운 채로 운영한다 ---
const campaign = (await admin('/api/admin/campaign')).body;
await admin('/api/admin/campaign/config', {
  method: 'PUT',
  body: {
    maxMessageLength: 30,
    submissionStart: null,
    submissionEnd: null,
    votingStart: null,
    votingEnd: null,
    absolutePiiDeadline: null,
    expectedRevision: campaign.revision,
  },
});
check('마감 없이도 접수됨', await submit('첫 좌석에 남기는 마음'), 201);
check('마감 없이도 접수됨 2', await submit('무대보다 먼저 도착한 밤'), 201);

const list = (await admin('/api/admin/submissions?limit=50')).body;
for (const row of list.rows) {
  await admin(`/api/admin/submissions/${row.id}`, {
    method: 'PATCH',
    body: { status: 'CANDIDATE', expectedRowVersion: row.rowVersion },
  });
}
// 화면과 같은 순서로 확인한다. 본 목록의 지문을 함께 보낸다.
const beforeConfirm = (await admin('/api/admin/shortlist')).body;
await admin('/api/admin/shortlist/confirm', {
  method: 'POST',
  body: { expectedPreparedDigest: beforeConfirm.preparedDigest },
});
const dashboard = (await admin('/api/admin/dashboard')).body;
const opened = await admin('/api/admin/campaign-actions', {
  method: 'POST',
  body: {
    action: 'OPEN_VOTING',
    idempotencyKey: randomUUID(),
    expectedRevision: dashboard.campaignRevision,
    expectedSnapshotDigest: dashboard.nextActionPreview.snapshotDigest,
  },
});
check('투표 시작', opened.body.state, 'VOTING_OPEN');

// --- 투표 화면 문구 ---
const votingCampaign = await (await fetch(`${PUBLIC_URL}/api/campaign`)).json();
check('투표 화면에 기간 안내 없음', /투표기간|투표 기간은/.test(JSON.stringify(votingCampaign.content.blocks)), false);

// --- 마감 없이 투표된다 ---
const candidates = await (await fetch(`${PUBLIC_URL}/api/candidates`)).json();
check('후보 공개', candidates.candidates.length, 2);

const voter = new Visitor();
await voter.start();
const voted = await voter.vote(candidates.candidates[0].id, candidates.setId);
if (voted.status !== 201) console.error('투표 실패 상세:', JSON.stringify(voted.body));
check('마감 없이도 투표됨', voted.status, 201);
check('완료 화면으로 이동 안내', voted.body.redirect, '/voted');

// --- 같은 참여자가 다시 들어오면 완료 화면 ---
const status = await voter.get('/api/vote-status');
check('투표 완료 상태 확인', status.body.voted, true);
const votedPage = await voter.get('/api/campaign?page=VOTED');
check('완료 화면 조회 200', votedPage.status, 200);

// receipt 쿠키가 사라져도 완료 화면을 볼 수 있어야 한다.
const names = [...voter.jar.keys()];
const receiptName = names.find((n) => n.includes('receipt'));
if (receiptName !== undefined) voter.jar.delete(receiptName);
const laterVisit = await voter.get('/api/campaign?page=VOTED');
check('receipt 만료 후에도 완료 화면 조회 200', laterVisit.status, 200);

// --- 중복 투표 ---
const again = await voter.post('/api/votes', {
  candidateId: candidates.candidates[1].id,
  setId: candidates.setId,
  turnstileToken: 'mock-vote',
});
check('같은 참여자 재투표 409', again.status, 409);
check('재투표 오류 코드', again.body.code, 'ALREADY_VOTED');

// --- 투표하지 않은 참여자는 완료 화면을 볼 수 없다 ---
const stranger = new Visitor();
await stranger.start();
check('투표 전에는 완료 화면 403', (await stranger.get('/api/campaign?page=VOTED')).status, 403);

// --- 다른 참여자는 정상 투표 ---
const second = new Visitor();
await second.start();
check('다른 참여자 투표 201', (await second.vote(candidates.candidates[1].id, candidates.setId)).status, 201);

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} 통과`);
process.exit(failures === 0 ? 0 : 1);
