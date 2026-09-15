import { canonicalJson, hmacSha256Hex, sha256Hex } from './hash.js';

/**
 * 같은 Idempotency-Key 재시도는 기존 결과를 돌려주고, 다른 payload면 409.
 * 일회용 Turnstile token은 HMAC 입력에 넣지 않는다. token 만료 때문에 새 응모가 생기면 안 된다.
 */

export interface IdempotencyScopeInput {
  readonly scope: string;
  readonly sessionHash: string;
  readonly key: string;
}

export async function keyHashOf(input: IdempotencyScopeInput): Promise<string> {
  return sha256Hex(`${input.scope}:${input.sessionHash}:${input.key}`);
}

export async function requestHmacOf(secret: string, payload: Record<string, unknown>): Promise<string> {
  return hmacSha256Hex(secret, canonicalJson(payload));
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
