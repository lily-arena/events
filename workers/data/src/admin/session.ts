import { DomainError } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { newId } from '../ids.js';
import type { AdminIdentity } from './common.js';

/**
 * 서버 Admin session. idle 30분, absolute 8시간을 넘으면 다시 로그인해야 한다.
 * reveal grant가 이 session에 묶이므로 열람 권한이 session 밖으로 새지 않는다.
 */

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export async function ensureAdminSession(
  env: DataEnv,
  admin: AdminIdentity,
  sessionHash: string,
): Promise<string> {
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id, admin_id, created_at, last_seen_at, expires_at, revoked_at
       FROM admin_sessions WHERE session_hash = ?`,
  )
    .bind(sessionHash)
    .first<{
      id: string;
      admin_id: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
      revoked_at: number | null;
    }>();

  if (existing !== null) {
    if (existing.admin_id !== admin.id) {
      throw new DomainError('FORBIDDEN', '세션 사용자가 일치하지 않습니다.');
    }
    const expired =
      existing.revoked_at !== null ||
      existing.expires_at <= now ||
      now - existing.last_seen_at > IDLE_MS ||
      now - existing.created_at > ABSOLUTE_MS;
    if (expired) {
      await env.DB.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
        .bind(now, existing.id)
        .run();
      throw new DomainError('UNAUTHENTICATED', '세션이 만료되었습니다. 다시 로그인해주세요.');
    }
    await env.DB.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?`).bind(now, existing.id).run();
    return existing.id;
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO admin_sessions(id, admin_id, session_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, admin.id, sessionHash, now, now, now + ABSOLUTE_MS)
    .run();
  return id;
}
