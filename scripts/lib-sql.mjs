import { createHash } from 'node:crypto';

export function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** packages/security의 canonicalJson과 같은 규칙. digest가 서비스 코드와 일치해야 한다. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  throw new TypeError('canonicalJson: 직렬화 불가');
}

export function digestOf(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
