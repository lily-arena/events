import { DomainError } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { auditStatements, requirePiiOfficer, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 개인정보 마스킹·원문 열람. Data Worker는 개인키가 없으므로 암호문만 돌려준다.
 * 복호화는 Admin Worker에서만 일어난다.
 */

export interface MaskView {
  readonly submissionId: string;
  readonly maskedName: string;
  readonly maskedPhone: string;
  readonly maskedEmail: string;
  readonly retentionUntil: number;
  readonly purposeCompletedAt: number | null;
  readonly deleted: boolean;
}

export async function getMask(
  env: DataEnv,
  admin: AdminIdentity,
  submissionId: string,
  requestId: string,
): Promise<MaskView> {
  requirePiiOfficer(admin);
  const row = await env.DB.prepare(
    `SELECT masked_name, masked_phone, masked_email, retention_until, purpose_completed_at
       FROM pii_contacts WHERE submission_id = ?`,
  )
    .bind(submissionId)
    .first<{
      masked_name: string;
      masked_phone: string;
      masked_email: string;
      retention_until: number;
      purpose_completed_at: number | null;
    }>();

  await env.DB.batch(
    auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'PII_MASK_VIEWED',
        targetType: 'submission',
        targetId: submissionId,
        outcome: 'SUCCESS',
        requestId,
        metadata: { deleted: row === null },
      },
      Date.now(),
    ),
  );

  if (row === null) {
    // 파기 완료된 건은 마스킹값도 남기지 않는다.
    return {
      submissionId,
      maskedName: '',
      maskedPhone: '',
      maskedEmail: '',
      retentionUntil: 0,
      purposeCompletedAt: null,
      deleted: true,
    };
  }
  return {
    submissionId,
    maskedName: row.masked_name,
    maskedPhone: row.masked_phone,
    maskedEmail: row.masked_email,
    retentionUntil: row.retention_until,
    purposeCompletedAt: row.purpose_completed_at,
    deleted: false,
  };
}

export interface StepUpInput {
  readonly adminSessionId: string;
  readonly submissionId: string;
  readonly nonceHash: string;
  readonly reason: string;
  readonly requestId: string;
}

/** 재인증 성공 후 대상·session에 묶인 일회 nonce를 발급한다. */
const GRANT_TTL_MS = 3 * 60 * 1000;

export async function createRevealGrant(
  env: DataEnv,
  admin: AdminIdentity,
  input: StepUpInput,
): Promise<{ grantId: string; expiresAt: number }> {
  requirePiiOfficer(admin);
  if (input.reason.trim().length < 5) {
    throw new DomainError('UNPROCESSABLE', '열람 사유를 입력해주세요.');
  }
  const now = Date.now();
  const grantId = newId();
  const expiresAt = now + GRANT_TTL_MS;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reveal_grants(id, admin_session_id, submission_id, nonce_hash, reason, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(grantId, input.adminSessionId, input.submissionId, input.nonceHash, input.reason.trim(), now, expiresAt),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'PII_REVEAL_GRANTED',
        targetType: 'submission',
        targetId: input.submissionId,
        outcome: 'SUCCESS',
        requestId: input.requestId,
        reason: input.reason.trim(),
      },
      now,
    ),
  ]);
  return { grantId, expiresAt };
}

export interface RevealInput {
  readonly adminSessionId: string;
  readonly submissionId: string;
  readonly nonceHash: string;
  readonly requestId: string;
}

export interface RevealCiphertext {
  readonly campaignId: string;
  readonly ciphertext: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: string;
  readonly aadVersion: number;
}

/**
 * nonce 소비와 audit intent를 같은 batch에 기록한 뒤에만 암호문을 가져온다.
 * 감사기록 쓰기가 실패하면 아무것도 반환하지 않는다.
 */
export async function consumeRevealGrant(
  env: DataEnv,
  admin: AdminIdentity,
  input: RevealInput,
): Promise<RevealCiphertext> {
  requirePiiOfficer(admin);
  const now = Date.now();

  const grant = await env.DB.prepare(
    `SELECT id FROM reveal_grants
      WHERE nonce_hash = ? AND admin_session_id = ? AND submission_id = ?
        AND consumed_at IS NULL AND expires_at > ?`,
  )
    .bind(input.nonceHash, input.adminSessionId, input.submissionId, now)
    .first<{ id: string }>();
  if (grant === null) throw new DomainError('FORBIDDEN', '열람 권한이 만료되었거나 이미 사용되었습니다.');

  // audit outbox 이관이 15분 이상 밀리면 열람을 막는다.
  const stale = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_outbox o JOIN audit_events e ON e.id = o.event_id
      WHERE o.delivered_at IS NULL AND e.occurred_at < ?`,
  )
    .bind(now - 15 * 60 * 1000)
    .first<{ n: number }>();
  if ((stale?.n ?? 0) > 0) {
    throw new DomainError('UNAVAILABLE', '감사기록 이관이 지연되어 열람할 수 없습니다.');
  }

  const guardId = newId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
         SELECT 1 FROM reveal_grants WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
       ) THEN 1 ELSE 0 END)`,
    ).bind(guardId, grant.id, now),
    env.DB.prepare(`UPDATE reveal_grants SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`).bind(
      now,
      grant.id,
    ),
    ...auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'PII_REVEAL_INTENT',
        targetType: 'submission',
        targetId: input.submissionId,
        outcome: 'SUCCESS',
        requestId: input.requestId,
      },
      now,
    ),
    env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId),
  ]);

  const row = await env.DB.prepare(
    `SELECT s.campaign_id, p.ciphertext, p.wrapped_dek, p.iv, p.key_version, p.aad_version
       FROM pii_contacts p JOIN submissions s ON s.id = p.submission_id
      WHERE p.submission_id = ?`,
  )
    .bind(input.submissionId)
    .first<{
      campaign_id: string;
      ciphertext: ArrayBuffer;
      wrapped_dek: ArrayBuffer;
      iv: ArrayBuffer;
      key_version: string;
      aad_version: number;
    }>();
  if (row === null) throw new DomainError('NOT_FOUND', '이미 파기된 정보입니다.');

  return {
    campaignId: row.campaign_id,
    ciphertext: new Uint8Array(row.ciphertext),
    wrappedDek: new Uint8Array(row.wrapped_dek),
    iv: new Uint8Array(row.iv),
    keyVersion: row.key_version,
    aadVersion: row.aad_version,
  };
}

export async function recordRevealOutcome(
  env: DataEnv,
  admin: AdminIdentity,
  submissionId: string,
  requestId: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<void> {
  await env.DB.batch(
    auditStatements(
      env,
      {
        actorId: admin.id,
        action: 'PII_REVEALED',
        targetType: 'submission',
        targetId: submissionId,
        outcome,
        requestId,
      },
      Date.now(),
    ),
  );
}
