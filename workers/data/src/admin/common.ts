import { DomainError } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { auditRecordKey, newId } from '../ids.js';

/**
 * Admin 공통.
 * 인증된 회사 담당자는 단일 권한으로 모든 운영 기능을 쓴다.
 * 역할별 분리와 타인 승인은 사용하지 않으며, 인증 여부만 서버가 확인한다.
 * 과거 역할 데이터는 이력으로 남겨 두되 새 작업의 조건으로 쓰지 않는다.
 */

export const ADMIN_ROLES = ['REVIEWER', 'OPERATOR', 'PII_OFFICER', 'OWNER', 'AUDITOR'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly AdminRole[];
}

/**
 * 인증된 회사 계정을 처음 보면 운영자로 등록한다.
 *
 * 이메일이 아니라 제공자와 고유 식별자(provider:subject)로 사람을 구분한다.
 * 이메일은 바뀔 수 있고, 같은 주소를 다른 사람이 이어받을 수도 있기 때문이다.
 *
 * 비활성으로 처리한 계정은 다시 살리지 않는다. 로그인에 성공해도 접근은 막힌다.
 * 브라우저가 보낸 문자열이 아니라 서버가 확인한 신원으로만 부른다.
 */
export async function provisionAdmin(
  env: DataEnv,
  identity: { provider: string; subject: string; email: string },
): Promise<void> {
  const accessSubject = `${identity.provider}:${identity.subject}`;
  const existing = await env.DB.prepare(
    `SELECT id, active, email FROM administrators WHERE access_subject = ?`,
  )
    .bind(accessSubject)
    .first<{ id: string; active: number; email: string }>();

  if (existing === null) {
    await env.DB.prepare(
      `INSERT INTO administrators(id, access_subject, email, active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(access_subject) DO NOTHING`,
    )
      .bind(newId(), accessSubject, identity.email, Date.now())
      .run();
    return;
  }

  // 이미 있는 계정은 활성 상태일 때만 이메일 표기를 최신으로 맞춘다.
  if (existing.active === 1 && existing.email !== identity.email) {
    await env.DB.prepare(`UPDATE administrators SET email = ? WHERE id = ?`)
      .bind(identity.email, existing.id)
      .run();
  }
}

export async function loadAdmin(env: DataEnv, accessSubject: string): Promise<AdminIdentity> {
  const row = await env.DB.prepare(
    `SELECT id, email FROM administrators WHERE access_subject = ? AND active = 1`,
  )
    .bind(accessSubject)
    .first<{ id: string; email: string }>();
  if (row === null) throw new DomainError('FORBIDDEN', '관리자 권한이 없습니다.');
  const roles = await env.DB.prepare(`SELECT role FROM admin_roles WHERE admin_id = ?`)
    .bind(row.id)
    .all<{ role: AdminRole }>();
  return { id: row.id, email: row.email, roles: roles.results.map((r) => r.role) };
}

/**
 * 인증된 회사 담당자인지만 확인한다.
 * 역할별 분리와 타인 승인은 쓰지 않는다. 역할 인자는 호출부 호환을 위해 남겨 두었고 판정에 쓰지 않는다.
 */
export function requireRole(admin: AdminIdentity, _allowed: readonly AdminRole[] = []): void {
  if (admin.id.length === 0) {
    throw new DomainError('UNAUTHENTICATED', '로그인이 필요합니다.');
  }
}

/** 개인정보 원문도 같은 로그인 세션에서 연다. 열람 사실은 서버가 자동으로 기록한다. */
export function requirePiiOfficer(admin: AdminIdentity): void {
  requireRole(admin);
}

export interface AuditInput {
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  readonly requestId: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  readonly sourceEnvelope?: Uint8Array;
}

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * audit_events와 outbox를 같은 batch에 넣을 statement 쌍을 만든다.
 * 원문·token·연락처는 metadata에 넣지 않는다.
 */
export function auditStatements(env: DataEnv, input: AuditInput, now: number): D1PreparedStatement[] {
  const eventId = newId();
  return [
    env.DB.prepare(
      `INSERT INTO audit_events(id, actor_id, action, target_type, target_id, occurred_at, source_envelope, reason, outcome, request_id, metadata_json, retention_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      now,
      input.sourceEnvelope ?? null,
      input.reason ?? null,
      input.outcome,
      input.requestId,
      JSON.stringify(input.metadata ?? {}),
      now + AUDIT_RETENTION_MS,
    ),
    env.DB.prepare(`INSERT INTO audit_outbox(event_id, r2_key, attempts, storage_backend) VALUES (?, ?, 0, 'D1')`).bind(
      eventId,
      auditRecordKey(now, eventId),
    ),
  ];
}

/** 감사기록만 단독으로 남긴다. 변경과 같은 batch에 넣을 수 없는 조회 감사에 쓴다. */
export async function writeAudit(env: DataEnv, input: AuditInput): Promise<void> {
  await env.DB.batch(auditStatements(env, input, Date.now()));
}

export interface ApprovalInput {
  readonly action: string;
  readonly payloadDigest: string;
  readonly makerId: string;
  readonly checkerId: string;
  readonly validForMs?: number;
}

const DEFAULT_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 과거 승인 기록용. 새 흐름에서는 쓰지 않는다.
 * 남아 있는 호출부 호환을 위해 유지하며 가짜 승인 행을 만들지 않는다.
 */
export function approvalStatement(
  env: DataEnv,
  approvalId: string,
  input: ApprovalInput,
  now: number,
): D1PreparedStatement {
  if (input.makerId === input.checkerId) {
    throw new DomainError('FORBIDDEN', '자신이 작성한 내용을 스스로 승인할 수 없습니다.');
  }
  return env.DB.prepare(
    `INSERT INTO approvals(id, action, payload_digest, maker_id, checker_id, approved_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    approvalId,
    input.action,
    input.payloadDigest,
    input.makerId,
    input.checkerId,
    now,
    now + (input.validForMs ?? DEFAULT_APPROVAL_TTL_MS),
  );
}

/** 목록 cursor. 마지막 정렬 key를 서버가 encode한다. */
export function encodeCursor(parts: readonly (string | number)[]): string {
  return btoa(JSON.stringify(parts)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export function decodeCursor(cursor: string | null): (string | number)[] | null {
  if (cursor === null || cursor.length === 0) return null;
  try {
    const padded = cursor.replace(/-/gu, '+').replace(/_/gu, '/');
    const parsed: unknown = JSON.parse(atob(padded));
    return Array.isArray(parsed) ? (parsed as (string | number)[]) : null;
  } catch {
    throw new DomainError('BAD_REQUEST', '잘못된 페이지 정보입니다.');
  }
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export function clampLimit(limit: number | null): number {
  if (limit === null || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}
