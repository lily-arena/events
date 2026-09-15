/**
 * 통합 테스트용 고정 상태 준비.
 *
 * 테스트마다 앞 테스트가 남긴 단계를 물려받지 않도록 각자 시작할 때 가상 seed를 다시 넣는다.
 * 개발용 가상 데이터 전용이며 운영 DB에는 절대 쓰지 않는다.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function resetFixture() {
  if (process.env.SKIP_FIXTURE_RESET === '1') return;
  const seed = spawnSync(process.execPath, [resolve(root, 'scripts/db-seed-demo.mjs')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (seed.status !== 0) {
    const detail = `${seed.stdout?.toString() ?? ''}${seed.stderr?.toString() ?? ''}`.slice(-800);
    throw new Error(`가상 seed 준비에 실패했습니다.\n${detail}`);
  }
}
