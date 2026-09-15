#!/usr/bin/env node
/**
 * 로컬 개발용 가상 seed. 실제 응모 데이터·실제 개인정보를 seed로 쓰지 않는다.
 * launch_approved=1은 로컬 fixture이며 운영 개시 승인이 아니다. launch-check가 별도로 차단한다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { q, digestOf } from './lib-sql.mjs';
import { PRIVACY_POLICY_BODY, LICENSE_POLICY_BODY } from './seed-policies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// npx는 샌드박스 밖 npm 캐시를 건드리므로 워크스페이스에 설치된 wrangler를 직접 쓴다.
const wranglerBin = resolve(root, 'node_modules/.bin/wrangler');
// 여러 워커가 같은 로컬 D1을 보도록 상태 경로를 고정한다.
const PERSIST_DIR = resolve(root, '.wrangler-state');
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const ids = {
  campaign: '11111111-1111-4111-8111-111111111111',
  adminA: '22222222-2222-4222-8222-222222222222',
  adminB: '33333333-3333-4333-8333-333333333333',
  // 권한 경계 테스트용 제한 계정. 심사만 할 수 있다.
  adminC: '44444444-4444-4444-8444-444444444444',
  approvalContent: randomUUID(),
  approvalPolicy: randomUUID(),
  policyPrivacy: randomUUID(),
  policyLicense: randomUUID(),
};

const SEED_PAGES = ['submission', 'submitted', 'voting', 'voted', 'waiting', 'result'];
const contentSeeds = SEED_PAGES.map((name) => ({
  name,
  id: randomUUID(),
  seed: JSON.parse(readFileSync(resolve(root, `packages/content/src/seed/${name}.json`), 'utf8')),
}));

const config = {
  campaignSlug: 'first-seat',
  maxMessageLength: 30,
  residency: 'KR_RESIDENT',
  organizerBrand: '서울아레나',
  note: 'local development fixture',
};

/**
 * 개발 편의를 위해 멱등하게 동작한다. 기존 가상 데이터를 지우고 다시 넣는다.
 * FK 때문에 자식 테이블부터 지운다. 운영 데이터에는 절대 사용하지 않는다.
 */
const RESET_ORDER = [
  'campaign_actions',
  'deletion_ledger', 'deletion_jobs', 'audit_outbox', 'audit_events',
  'result_media', 'result_versions', 'jury_scores',
  'vote_decisions', 'vote_risk_signals', 'votes',
  'session_policy_receipts', 'reveal_grants', 'admin_sessions',
  'consent_receipts', 'pii_contacts', 'candidates', 'candidate_sets',
  'submissions', 'anonymous_sessions', 'idempotency_records', 'rate_buckets',
  'operation_guards', 'job_cursors', 'transition_events',
  'content_publications', 'content_versions',
  'campaign_policies', 'policy_documents', 'campaign_revisions', 'campaigns',
  'approvals', 'admin_roles', 'administrators',
];

/**
 * 리셋 동안에는 모든 trigger를 내렸다가 원래 정의 그대로 복구한다.
 * 정의는 DB의 sqlite_master에서 읽으므로 migration과 항상 일치한다.
 * 운영 데이터에는 절대 사용하지 않는 개발 전용 경로다.
 */
function runSql(sql) {
  return spawnSync(
    wranglerBin,
    ['d1', 'execute', 'first-seat', '--local', '--config', 'workers/data/wrangler.jsonc',
     '--command', sql, '--yes', '--json', '--persist-to', PERSIST_DIR],
    { cwd: root, encoding: 'utf8' },
  );
}

const triggerQuery = runSql("SELECT name, sql FROM sqlite_master WHERE type='trigger'");
let existingTriggers = [];
try {
  const parsed = JSON.parse(triggerQuery.stdout.slice(triggerQuery.stdout.indexOf('[')));
  existingTriggers = parsed[0]?.results ?? [];
} catch {
  existingTriggers = [];
}

const statements = [
  'PRAGMA foreign_keys = OFF;',
  ...existingTriggers.map((t) => `DROP TRIGGER IF EXISTS ${t.name};`),
  ...RESET_ORDER.map((table) => `DELETE FROM ${table};`),
  ...existingTriggers.map((t) => `${t.sql};`),
  'PRAGMA foreign_keys = ON;',

  // 예정 마감처럼 사람이 아닌 주체가 수행하는 전환의 실행 주체. 로그인할 수 없다.
  `INSERT INTO administrators(id, access_subject, email, active, created_at) VALUES
   ('00000000-0000-4000-8000-0000000000ff', 'system:scheduler', 'scheduler@first-seat.internal', 0, ${now}),
   (${q(ids.adminA)}, 'dev-operator', 'operator@seoularena.net', 1, ${now});`,

  // 역할은 이력 호환용으로만 남긴다. 새 흐름은 인증 여부만 확인한다.
  `INSERT INTO admin_roles(admin_id, role) VALUES (${q(ids.adminA)}, 'OWNER');`,

  `INSERT INTO campaigns(id, slug, state, paused, revision, max_message_length,
     submission_start, submission_end, voting_start, voting_end, voting_epoch,
     absolute_pii_deadline, launch_approved, created_at, updated_at)
   VALUES (${q(ids.campaign)}, 'first-seat', 'SUBMISSION_OPEN', 0, 1, 30,
     ${now - DAY}, ${now + 30 * DAY}, NULL, NULL, 0, NULL, 1, ${now}, ${now});`,

  `INSERT INTO campaign_revisions(campaign_id, revision, config_json, digest, actor_id, approval_id, created_at)
   VALUES (${q(ids.campaign)}, 1, ${q(JSON.stringify(config))}, ${q(digestOf(config))}, ${q(ids.adminA)}, NULL, ${now});`,

  // 승인은 maker와 checker가 달라야 한다.
  `INSERT INTO approvals(id, action, payload_digest, maker_id, checker_id, approved_at, expires_at) VALUES
   (${q(ids.approvalPolicy)}, 'POLICY_APPROVE', ${q(digestOf({ kind: 'seed-policies' }))}, ${q(ids.adminA)}, '00000000-0000-4000-8000-0000000000ff', ${now}, ${now + 365 * DAY});`,

  `INSERT INTO policy_documents(id, campaign_id, kind, version, body, digest, approval_id, effective_at, created_at) VALUES
   (${q(ids.policyPrivacy)}, ${q(ids.campaign)}, 'PRIVACY', 1, ${q(PRIVACY_POLICY_BODY)}, ${q(digestOf(PRIVACY_POLICY_BODY))}, ${q(ids.approvalPolicy)}, ${now}, ${now}),
   (${q(ids.policyLicense)}, ${q(ids.campaign)}, 'WORK_LICENSE', 1, ${q(LICENSE_POLICY_BODY)}, ${q(digestOf(LICENSE_POLICY_BODY))}, ${q(ids.approvalPolicy)}, ${now}, ${now});`,

  `INSERT INTO campaign_policies(campaign_id, kind, policy_id, required) VALUES
   (${q(ids.campaign)}, 'PRIVACY', ${q(ids.policyPrivacy)}, 1),
   (${q(ids.campaign)}, 'WORK_LICENSE', ${q(ids.policyLicense)}, 1);`,

  `INSERT INTO content_versions(id, campaign_id, page, locale, version, body_json, digest, status, legal_change, policy_refs_json, maker_id, approval_id, row_version, created_at, updated_at) VALUES
   ${contentSeeds
     .map(
       ({ id, seed }) =>
         `(${q(id)}, ${q(ids.campaign)}, ${q(seed.page)}, 'ko', 1, ${q(JSON.stringify(seed.body))}, ${q(digestOf(seed.body))}, 'PUBLISHED', ${seed.page === 'SUBMISSION' ? 1 : 0}, ${seed.page === 'SUBMISSION' ? q(JSON.stringify({ PRIVACY: ids.policyPrivacy, WORK_LICENSE: ids.policyLicense })) : "'{}'"}, ${q(ids.adminA)}, NULL, 1, ${now}, ${now})`,
     )
     .join(',\n   ')};`,

  `INSERT INTO content_publications(campaign_id, page, locale, content_version_id, revision, published_by, published_at) VALUES
   ${contentSeeds
     .map(({ id, seed }) => `(${q(ids.campaign)}, ${q(seed.page)}, 'ko', ${q(id)}, 1, ${q(ids.adminA)}, ${now})`)
     .join(',\n   ')};`,
];

const dir = mkdtempSync(join(tmpdir(), 'first-seat-seed-'));
const file = join(dir, 'seed.sql');
writeFileSync(file, statements.join('\n\n'), 'utf8');

const result = spawnSync(
  wranglerBin,
  ['d1', 'execute', 'first-seat', '--local', '--config', 'workers/data/wrangler.jsonc', '--file', file, '--yes', '--persist-to', PERSIST_DIR],
  { cwd: root, stdio: 'inherit' },
);
if (result.status === 0) console.log('seed 완료 (가상 데이터, 실제 응모 데이터 아님)');
process.exit(result.status ?? 1);
