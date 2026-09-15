#!/usr/bin/env node
/**
 * 로컬 D1에 migration을 적용한다.
 *
 * 공식 `wrangler d1 migrations apply`를 쓴다. 적용 이력이 `d1_migrations`에 남아
 * 두 번 실행해도 이미 적용한 파일을 다시 실행하지 않는다.
 *
 * 원격 운영 DB는 여기서 건드리지 않는다. `npm run db:migrate:remote`를 쓴다.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// npx는 샌드박스 밖 npm 캐시를 건드리므로 워크스페이스에 설치된 wrangler를 직접 쓴다.
const wranglerBin = resolve(root, 'node_modules/.bin/wrangler');
// 여러 워커가 같은 로컬 D1을 보도록 상태 경로를 고정한다.
const PERSIST_DIR = resolve(root, '.wrangler-state');
const CONFIG = 'workers/data/wrangler.jsonc';

const adopt = spawnSync(process.execPath, [resolve(root, 'scripts/db-adopt-migrations.mjs'), '--local'], {
  cwd: root,
  stdio: 'inherit',
});
if (adopt.status !== 0) process.exit(adopt.status ?? 1);

const applied = spawnSync(
  wranglerBin,
  ['d1', 'migrations', 'apply', 'first-seat', '--local', '--config', CONFIG, '--persist-to', PERSIST_DIR],
  { cwd: root, stdio: 'inherit' },
);
process.exit(applied.status ?? 1);
