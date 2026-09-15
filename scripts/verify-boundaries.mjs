#!/usr/bin/env node
/**
 * 서비스 경계 검사. 빌드 산출물과 설정에서 키·바인딩이 새지 않는지 확인한다.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function readJsonc(path) {
  // 줄 주석과 블록 주석을 걷어낸다. 주소 안의 //는 줄 처음이 아니므로 건드리지 않는다.
  const text = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text);
}

// 1. D1 binding은 Data Worker만 가진다.
const dataConfig = readJsonc(resolve(root, 'workers/data/wrangler.jsonc'));
const publicConfig = readJsonc(resolve(root, 'workers/public/wrangler.jsonc'));
if (!Array.isArray(dataConfig.d1_databases) || dataConfig.d1_databases.length === 0) {
  problems.push('Data Worker에 D1 binding이 없습니다.');
}
if (publicConfig.d1_databases !== undefined) problems.push('Public Worker에 D1 binding이 있습니다.');
if (publicConfig.r2_buckets !== undefined) problems.push('Public Worker에 R2 binding이 있습니다.');

for (const config of [dataConfig, dataConfig.env?.production]) {
  if (config?.r2_buckets !== undefined) problems.push('D1 전용 구조에 R2 binding을 추가할 수 없습니다.');
}

// 2. Data Worker는 외부 route를 갖지 않는다.
if (dataConfig.workers_dev !== false) problems.push('Data Worker의 workers_dev를 false로 두세요.');
if (dataConfig.routes !== undefined || dataConfig.route !== undefined) {
  problems.push('Data Worker에 외부 route가 설정되어 있습니다.');
}

// 3. Public Worker 소스가 개인키를 참조하지 않는다.
const publicSources = readdirSync(resolve(root, 'workers/public/src'));
for (const file of publicSources) {
  const text = readFileSync(resolve(root, 'workers/public/src', file), 'utf8');
  if (text.includes('PII_PRIVATE_KEY')) problems.push(`Public Worker가 개인키를 참조합니다: ${file}`);
  if (/\bDB\b\s*:/.test(text)) problems.push(`Public Worker가 D1 binding을 선언합니다: ${file}`);
}

// 4. Public 정적 bundle에 비밀값·Admin 코드가 들어가지 않는다.
const distDir = resolve(root, 'apps/public/dist/assets');
if (existsSync(distDir)) {
  const forbidden = ['PII_PRIVATE_KEY', 'SESSION_SECRET', 'TURNSTILE_SECRET', 'IP_HMAC_KEY', 'AUDIT_SIGNING_SECRET'];
  for (const file of readdirSync(distDir)) {
    const text = readFileSync(join(distDir, file), 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) problems.push(`Public bundle에 ${needle} 문자열이 있습니다: ${file}`);
    }
    if (/\/api\/admin\//.test(text)) problems.push(`Public bundle에 Admin API 경로가 있습니다: ${file}`);
  }
} else {
  problems.push('Public bundle이 없습니다. 먼저 빌드하세요.');
}

// 5. Admin bundle에도 비밀값이 들어가지 않는다.
const adminDist = resolve(root, 'apps/admin/dist/assets');
if (existsSync(adminDist)) {
  const forbidden = ['PII_PRIVATE_KEY', 'SESSION_SECRET', 'TURNSTILE_SECRET', 'IP_HMAC_KEY', 'AUDIT_SIGNING_SECRET'];
  for (const file of readdirSync(adminDist)) {
    const text = readFileSync(join(adminDist, file), 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) problems.push(`Admin bundle에 ${needle} 문자열이 있습니다: ${file}`);
    }
  }
} else {
  problems.push('Admin bundle이 없습니다. 먼저 빌드하세요.');
}

// 6. Admin Worker 설정 점검
const adminConfig = readJsonc(resolve(root, 'workers/admin/wrangler.jsonc'));
if (adminConfig.d1_databases !== undefined) problems.push('Admin Worker에 D1 binding이 있습니다.');
if (adminConfig.vars?.ENVIRONMENT === 'production' && adminConfig.vars?.ACCESS_MODE === 'mock') {
  problems.push('production 설정에 Access mock 모드가 켜져 있습니다.');
}
const adminService = (adminConfig.services ?? []).find((s) => s.binding === 'DATA');
if (adminService?.entrypoint !== 'AdminData') problems.push('Admin Worker는 AdminData entrypoint를 써야 합니다.');
const publicService = (publicConfig.services ?? []).find((s) => s.binding === 'DATA');
if (publicService?.entrypoint !== 'PublicData') problems.push('Public Worker는 PublicData entrypoint를 써야 합니다.');

// 7. dev용 mock 설정이 production에 남지 않게 한다.
if (publicConfig.vars?.ENVIRONMENT === 'production' && publicConfig.vars?.TURNSTILE_MODE === 'mock') {
  problems.push('production 설정에 Turnstile mock 모드가 켜져 있습니다.');
}

// 8. 화면은 Vercel이 서빙한다. Worker는 정적 자산을 갖지 않는다.
for (const [label, config] of [['Public', publicConfig], ['Admin', adminConfig]]) {
  if (config.assets !== undefined) {
    problems.push(`${label} Worker에 assets binding이 있습니다. 화면은 Vercel이 서빙합니다.`);
  }
  if (config.env?.production?.assets !== undefined) {
    problems.push(`${label} Worker production 설정에 assets binding이 있습니다.`);
  }
}

// 9. production 설정 점검. 최상위 vars가 아니라 env.production을 본다.
function originsOf(value) {
  return String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function checkProductionEnv(label, config, { mockKey, mockValue }) {
  const prod = config.env?.production;
  if (prod === undefined) {
    problems.push(`${label} Worker에 production 환경 설정이 없습니다.`);
    return null;
  }
  if (prod.vars?.ENVIRONMENT !== 'production') {
    problems.push(`${label} Worker production 설정의 ENVIRONMENT가 production이 아닙니다.`);
  }
  if (mockKey !== null && prod.vars?.[mockKey] === mockValue) {
    problems.push(`${label} Worker production 설정에 ${mockKey}=${mockValue}가 남아 있습니다.`);
  }
  // 브라우저는 Worker를 직접 부르지 않는다. 서명 없는 요청을 받아들이면 안 된다.
  if (prod.vars?.GATEWAY_MODE !== 'signed') {
    problems.push(`${label} Worker production 설정의 GATEWAY_MODE가 signed가 아닙니다.`);
  }
  const origins = originsOf(prod.vars?.ALLOWED_ORIGINS);
  if (origins.length === 0) {
    problems.push(`${label} Worker production 설정에 허용 출처가 없습니다.`);
  }
  for (const origin of origins) {
    if (!origin.startsWith('https://')) {
      problems.push(`${label} Worker production 허용 출처가 https가 아닙니다: ${origin}`);
    }
    if (/localhost|127\.0\.0\.1/.test(origin)) {
      problems.push(`${label} Worker production 허용 출처에 로컬 주소가 있습니다: ${origin}`);
    }
  }
  // 회사 도메인을 붙이지 않는다. 붙이면 브라우저가 직접 부를 수 있게 되어 설계가 깨진다.
  if (prod.routes !== undefined || prod.route !== undefined) {
    problems.push(`${label} Worker production 설정에 custom domain route가 있습니다. 중계 구조에서는 두지 않습니다.`);
  }
  return prod;
}

checkProductionEnv('Public', publicConfig, { mockKey: 'TURNSTILE_MODE', mockValue: 'mock' });
checkProductionEnv('Admin', adminConfig, { mockKey: 'GATEWAY_MODE', mockValue: 'dev' });

// 10-b. production Worker 이름과 service binding 대상이 일치해야 한다.
// 이름을 비워 두면 wrangler가 환경 접미사를 붙여 배포하므로 binding 대상이 어긋난다.
const dataProdName = dataConfig.env?.production?.name;
if (dataProdName === undefined) {
  problems.push('Data Worker production 설정에 name이 없습니다. 운영 이름을 명시하세요.');
}
for (const [label, config] of [['Public', publicConfig], ['Admin', adminConfig]]) {
  const prod = config.env?.production;
  if (prod?.name === undefined) {
    problems.push(`${label} Worker production 설정에 name이 없습니다.`);
  }
  const target = (prod?.services ?? []).find((s) => s.binding === 'DATA')?.service;
  if (target !== dataProdName) {
    problems.push(
      `${label} Worker production의 DATA 대상(${target})이 Data Worker 운영 이름(${dataProdName})과 다릅니다.`,
    );
  }
}

// 10-c. d1 migrations 명령이 찾을 경로가 명시되어야 한다. D1 항목 안에 둔다.
for (const [label, list] of [
  ['개발', dataConfig.d1_databases ?? []],
  ['production', dataConfig.env?.production?.d1_databases ?? []],
]) {
  for (const db of list) {
    if (db.migrations_dir === undefined) {
      problems.push(`Data Worker ${label} D1 설정에 migrations_dir이 없습니다.`);
    }
  }
}

// 11. Data Worker는 production에서도 외부 route가 없고 파기·정리 cron을 유지한다.
const dataProd = dataConfig.env?.production;
if (dataProd === undefined) {
  problems.push('Data Worker에 production 환경 설정이 없습니다.');
} else {
  if (dataProd.routes !== undefined || dataProd.route !== undefined) {
    problems.push('Data Worker production 설정에 외부 route가 있습니다.');
  }
  if (!Array.isArray(dataProd.triggers?.crons) || dataProd.triggers.crons.length === 0) {
    problems.push('Data Worker production 설정에 파기·정리 cron이 없습니다.');
  }
  if (!Array.isArray(dataProd.d1_databases) || dataProd.d1_databases.length === 0) {
    problems.push('Data Worker production 설정에 D1 binding이 없습니다.');
  }
}

/*
 * 12. Worker가 부르는 RPC가 Data Worker에 실제로 있는지 본다.
 * RPC는 타입이 interface로만 선언되어 있어 이름이 어긋나도 컴파일은 통과하고
 * 실제 호출에서야 503으로 터진다. 배포 전에 정적으로 잡는다.
 */
function methodsOfClass(source, className, nextClassName) {
  const start = source.indexOf(`export class ${className}`);
  if (start < 0) return null;
  const end = nextClassName === null ? source.length : source.indexOf(`export class ${nextClassName}`);
  const body = source.slice(start, end > start ? end : source.length);
  return new Set([...body.matchAll(/^ {2}(?:async )?([a-zA-Z0-9_]+)\s*\(/gm)].map((m) => m[1]));
}

function calledRpcNames(files) {
  const names = new Set();
  for (const file of files) {
    const text = readFileSync(resolve(root, file), 'utf8');
    for (const match of text.matchAll(/env\.DATA\.([a-zA-Z0-9_]+)\s*\(/g)) names.add(match[1]);
  }
  return [...names].sort();
}

const dataSource = readFileSync(resolve(root, 'workers/data/src/index.ts'), 'utf8');
const publicMethods = methodsOfClass(dataSource, 'PublicData', 'AdminData');
const adminMethods = methodsOfClass(dataSource, 'AdminData', null);

if (publicMethods === null) problems.push('Data Worker에 PublicData entrypoint가 없습니다.');
if (adminMethods === null) problems.push('Data Worker에 AdminData entrypoint가 없습니다.');

if (publicMethods !== null) {
  const publicFiles = readdirSync(resolve(root, 'workers/public/src'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `workers/public/src/${f}`);
  for (const name of calledRpcNames(publicFiles)) {
    if (!publicMethods.has(name)) problems.push(`PublicData에 없는 RPC를 호출합니다: ${name}`);
  }
}
if (adminMethods !== null) {
  const adminFiles = readdirSync(resolve(root, 'workers/admin/src'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `workers/admin/src/${f}`);
  for (const name of calledRpcNames(adminFiles)) {
    if (!adminMethods.has(name)) problems.push(`AdminData에 없는 RPC를 호출합니다: ${name}`);
  }
}

if (problems.length === 0) {
  console.log('verify:boundaries PASS');
  process.exit(0);
}
console.log('verify:boundaries FAIL');
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
