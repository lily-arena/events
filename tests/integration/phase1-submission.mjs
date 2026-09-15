#!/usr/bin/env node
/**
 * Phase 1 접수 통합 테스트. 실행 중인 로컬 dev 서버(기본 http://localhost:8787)를 대상으로 한다.
 * 가상 데이터만 사용하며 실제 cloud·실제 개인정보를 쓰지 않는다.
 */
import { randomUUID } from 'node:crypto';
import { resetFixture } from '../lib/fixture.mjs';

// 앞 테스트가 남긴 단계를 물려받지 않도록 각 테스트가 스스로 가상 데이터를 초기화한다.
resetFixture();

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const results = [];
let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  (기대 ${expected}, 실제 ${actual})`);
}

/** 아주 작은 쿠키 jar. 브라우저 없이 서버 발급 session을 유지한다. */
class Jar {
  constructor() {
    this.cookies = new Map();
  }
  capture(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function getCampaign() {
  const response = await fetch(`${BASE}/api/campaign`);
  return response.json();
}

async function startSession(jar) {
  const response = await fetch(`${BASE}/api/submission-session`, {
    method: 'POST',
    headers: { Origin: BASE },
  });
  jar.capture(response);
  return { status: response.status, body: await response.json() };
}

async function submit(jar, csrfToken, payload, { key = randomUUID(), withCsrf = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: BASE,
    'Idempotency-Key': key,
    Cookie: jar.header(),
  };
  if (withCsrf) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${BASE}/api/submissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  jar.capture(response);
  return { status: response.status, body: await response.json() };
}

function basePayload(campaign, overrides = {}) {
  const policyIds = campaign.policies.filter((p) => p.required).map((p) => p.id);
  return {
    message: '무대보다 먼저 도착한 마음',
    name: '홍길동',
    phone: '010-1234-5678',
    email: 'test@example.com',
    configRevision: campaign.revision,
    contentVersionId: campaign.content.versionId,
    consents: policyIds.map((id) => ({ policyId: id, accepted: true })),
    turnstileToken: 'mock-submission',
    ...overrides,
  };
}

const campaign = await getCampaign();
const jar = new Jar();
const session = await startSession(jar);
check('세션 bootstrap 201', session.status, 201);
const csrf = session.body.csrfToken;

// 사용자 카피 계약
const blocks = campaign.content.blocks;
const keyOrder = blocks.map((b) => b.key).join(',');
check(
  '공모 화면 block 순서(제외 기준이 문구 입력 아래)',
  keyOrder,
  'hero,intro,message_label,message_helper,exclusion_heading,exclusions,entrant_heading,entrant_helper,privacy_label,license_label,notices_heading,notices,submit',
);
check('유의사항 9개', blocks.find((b) => b.key === 'notices').items.length, 9);
check('maxMessageLength 치환', blocks.find((b) => b.key === 'message_helper').text, '최대 30자');
check(
  '당첨 안내 원문 유지',
  blocks.find((b) => b.key === 'entrant_helper').text,
  '당첨 안내 및 결과 확인을 위해 정확한 정보를 입력해주세요.',
);
check('Public DTO에 internalNotes 없음', JSON.stringify(campaign).includes('internalNotes'), false);
check('제외 기준 5개', blocks.find((b) => b.key === 'exclusions').items.length, 5);

// 정상 접수 + 멱등
const key = randomUUID();
const first = await submit(jar, csrf, basePayload(campaign), { key });
check('정상 접수 201', first.status, 201);
check('성공 응답에 submission ID 없음', JSON.stringify(first.body).includes('submissionId'), false);
const retry = await submit(jar, csrf, basePayload(campaign), { key });
check('같은 key 재시도 200', retry.status, 200);
const conflict = await submit(jar, csrf, basePayload(campaign, { message: '다른 문구' }), { key });
check('같은 key 다른 payload 409', conflict.status, 409);

// 입력 규칙
check('30자 허용', (await submit(jar, csrf, basePayload(campaign, { message: '가'.repeat(30) }))).status, 201);
const over = await submit(jar, csrf, basePayload(campaign, { message: '가'.repeat(31) }));
check('31자 거절 422', over.status, 422);
check('31자 오류 field', over.body.fieldErrors?.[0]?.field, 'message');
check(
  '이모지 결합 문자 1자로 계산',
  (await submit(jar, csrf, basePayload(campaign, { message: '가'.repeat(29) + '👨‍👩‍👧' }))).status,
  201,
);
check(
  '줄바꿈 거절',
  (await submit(jar, csrf, basePayload(campaign, { message: '첫 줄\n둘째 줄' }))).status,
  422,
);
const badContact = await submit(jar, csrf, basePayload(campaign, { phone: 'abc', email: 'not-an-email' }));
check('연락처·이메일 형식 422', badContact.status, 422);
check('오류 field 2개', badContact.body.fieldErrors?.length, 2);

// 동의·보안
const oneConsent = basePayload(campaign);
check(
  '필수 동의 누락 422',
  (await submit(jar, csrf, { ...oneConsent, consents: [oneConsent.consents[0]] })).status,
  422,
);
check('CSRF 헤더 없음 403', (await submit(jar, csrf, basePayload(campaign), { withCsrf: false })).status, 403);
check(
  '잘못된 challenge 403',
  (await submit(jar, csrf, basePayload(campaign, { turnstileToken: 'bad' }))).status,
  403,
);
check(
  'unknown field 400',
  (await submit(jar, csrf, { ...basePayload(campaign), nickname: 'x' })).status,
  400,
);
check(
  'contentVersionId 불일치 409',
  (await submit(jar, csrf, basePayload(campaign, { contentVersionId: randomUUID() }))).status,
  409,
);

// 세션 없는 요청
const noSession = await fetch(`${BASE}/api/submissions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, 'Idempotency-Key': randomUUID() },
  body: JSON.stringify(basePayload(campaign)),
});
check('세션 쿠키 없음 401', noSession.status, 401);

// 교차 출처
const crossOrigin = await fetch(`${BASE}/api/submissions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://evil.example',
    'X-CSRF-Token': csrf,
    'Idempotency-Key': randomUUID(),
    Cookie: jar.header(),
  },
  body: JSON.stringify(basePayload(campaign)),
});
check('다른 출처 403', crossOrigin.status, 403);

// 접수완료 화면 접근 통제
const noReceipt = await fetch(`${BASE}/api/campaign?page=SUBMITTED`);
check('receipt 없이 완료 화면 조회 403', noReceipt.status, 403);
const withReceipt = await fetch(`${BASE}/api/campaign?page=SUBMITTED`, { headers: { Cookie: jar.header() } });
check('receipt 있으면 완료 화면 조회 200', withReceipt.status, 200);
const submittedBody = await withReceipt.json();
const submittedKeys = submittedBody.content.blocks.map((b) => b.key);
check('완료 화면 CTA는 돌아가기 하나', submittedKeys.filter((k) => k === 'back').length, 1);
check(
  '완료 화면에 공유·인스타 CTA 없음',
  /instagram|공유|다른 문구/i.test(JSON.stringify(submittedBody)),
  false,
);

// Data Worker 직접 노출 없음
const dataDirect = await fetch(`${BASE}/api/../`, { redirect: 'manual' });
check('알 수 없는 API 경로 404', (await fetch(`${BASE}/api/unknown`)).status, 404);
void dataDirect;

console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures === 0 ? 0 : 1);
