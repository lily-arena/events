import { toHex } from './bytes.js';

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toHex(new Uint8Array(signature));
}

/**
 * 정렬된 키로 직렬화한 canonical JSON. digest·HMAC 입력으로 쓰며
 * 같은 값이 다른 키 순서로 다른 해시를 내지 않게 한다.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError('canonicalJson: 직렬화할 수 없는 값');
}

export async function digestOf(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
