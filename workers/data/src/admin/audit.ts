import type { DataEnv } from '../env.js';
import { clampLimit, decodeCursor, encodeCursor, requireRole, type AdminIdentity } from './common.js';

/** 감사 조회. 원문·token·연락처는 담기지 않으며 관리자 접속지는 암호문이라 반환하지 않는다. */

export interface AuditRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly occurredAt: number;
  readonly outcome: string;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown>;
  readonly delivered: boolean;
}

export interface AuditList {
  readonly rows: readonly AuditRow[];
  readonly nextCursor: string | null;
  readonly pendingDelivery: number;
}

export async function listAudit(
  env: DataEnv,
  admin: AdminIdentity,
  filters: { action: string | null; targetId: string | null; cursor: string | null; limit: number | null },
): Promise<AuditList> {
  requireRole(admin, ['AUDITOR', 'OWNER']);
  const limit = clampLimit(filters.limit);
  const where: string[] = ['1 = 1'];
  const binds: (string | number)[] = [];

  if (filters.action !== null && filters.action.length > 0) {
    where.push('e.action = ?');
    binds.push(filters.action);
  }
  if (filters.targetId !== null && filters.targetId.length > 0) {
    where.push('e.target_id = ?');
    binds.push(filters.targetId);
  }
  const cursor = decodeCursor(filters.cursor);
  if (cursor !== null) {
    where.push('(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))');
    binds.push(Number(cursor[0]), Number(cursor[0]), String(cursor[1]));
  }

  const rows = await env.DB.prepare(
    `SELECT e.id, e.actor_id, a.email AS actor_email, e.action, e.target_type, e.target_id,
            e.occurred_at, e.outcome, e.reason, e.metadata_json,
            (SELECT o.delivered_at FROM audit_outbox o WHERE o.event_id = e.id) AS delivered_at
       FROM audit_events e LEFT JOIN administrators a ON a.id = e.actor_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      actor_id: string | null;
      actor_email: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      occurred_at: number;
      outcome: string;
      reason: string | null;
      metadata_json: string;
      delivered_at: number | null;
    }>();

  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.results.length > limit && last !== undefined ? encodeCursor([last.occurred_at, last.id]) : null;

  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_outbox WHERE delivered_at IS NULL`).first<{
    n: number;
  }>();

  return {
    rows: page.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      occurredAt: row.occurred_at,
      outcome: row.outcome,
      reason: row.reason,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      delivered: row.delivered_at !== null,
    })),
    nextCursor,
    pendingDelivery: pending?.n ?? 0,
  };
}
