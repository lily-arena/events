#!/usr/bin/env node
// 개발용 RSA-OAEP 키쌍과 dev secret을 만든다.
// 실제 운영 키는 이 스크립트로 만들지 않으며 저장소에 넣지 않는다.
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function b64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function randomSecret() {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

const pair = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['encrypt', 'decrypt'],
);
const spki = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
const pkcs8 = b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

const sessionSecret = randomSecret();
const ipHmacKey = randomSecret();

const publicVars = [
  '# 개발 전용. 실제 운영 secret이 아니며 커밋 대상이 아니다.',
  `SESSION_SECRET="${sessionSecret}"`,
  `IP_HMAC_KEY="${ipHmacKey}"`,
  'TURNSTILE_SECRET="dev-mock-secret"',
  `PII_PUBLIC_KEY="${spki}"`,
  '',
].join('\n');

const adminVars = [
  '# 개발 전용 PII 개인키. Admin Worker에만 둔다.',
  `PII_PRIVATE_KEY="${pkcs8}"`,
  `SESSION_SECRET="${sessionSecret}"`,
  '',
].join('\n');

for (const [path, contents] of [
  [resolve(root, 'workers/public/.dev.vars'), publicVars],
  [resolve(root, 'workers/admin/.dev.vars'), adminVars],
]) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && process.argv[2] !== '--force') {
    console.log(`skip (이미 있음): ${path}`);
    continue;
  }
  writeFileSync(path, contents, 'utf8');
  console.log(`wrote ${path}`);
}
