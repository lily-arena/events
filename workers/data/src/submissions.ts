import { DomainError, checkMessage, retentionDays } from '@first-seat/domain';
import { IDEMPOTENCY_TTL_MS } from '@first-seat/security';
import type { DataEnv } from './env.js';
import type { IdempotencyRow } from './rows.js';
import { auditRecordKey, newId } from './ids.js';
import { loadCampaign, loadPublishedContent } from './campaign.js';

/**
 * 응모 접수. Public Worker가 암호화한 envelope와 마스킹값만 받는다.
 * Data Worker는 PII 개인키를 갖지 않으므로 평문 연락처를 볼 수 없다.
 */

export interface SubmissionEnvelopeInput {
  readonly ciphertext: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: string;
  readonly aadVersion: number;
  readonly maskedName: string;
  readonly maskedPhone: string;
  readonly maskedEmail: string;
}

export interface CreateSubmissionInput {
  readonly campaignSlug: string;
  readonly submissionId: string;
  readonly message: string;
  readonly configRevision: number;
  readonly contentVersionId: string;
  readonly consentPolicyIds: readonly string[];
  readonly envelope: SubmissionEnvelopeInput;
  readonly sessionHash: string;
  readonly idempotencyKeyHash: string;
  readonly requestHmac: string;
  readonly requestId: string;
  readonly rateSubjectHmac: string;
}

export interface CreateSubmissionResult {
  readonly status: 201 | 200;
  readonly submissionId: string;
}

/** 접수 rate limit 초기 가상값. 실제 D1 rows 측정 후 확정한다. */
const SUBMISSION_RATE_WINDOW_MS = 5 * 60 * 1000;
const SUBMISSION_RATE_LIMIT = 20;

const IDEMPOTENCY_SCOPE = 'submission';

export async function createSubmission(
  env: DataEnv,
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  const campaign = await loadCampaign(env, input.campaignSlug);
  const now = Date.now();

  // 같은 key 재시도는 새 응모를 만들지 않는다.
  const prior = await env.DB.prepare(
    `SELECT request_hmac, resource_id, http_status FROM idempotency_records
      WHERE scope = ? AND session_hash = ? AND key_hash = ? AND expires_at > ?`,
  )
    .bind(IDEMPOTENCY_SCOPE, input.sessionHash, input.idempotencyKeyHash, now)
    .first<IdempotencyRow>();
  if (prior !== null) {
    if (prior.request_hmac !== input.requestHmac) {
      throw new DomainError('DUPLICATE_KEY', '같은 요청 key로 다른 내용이 전송되었습니다.');
    }
    return { status: 200, submissionId: prior.resource_id };
  }

  if (campaign.launch_approved !== 1) {
    throw new DomainError('UNAVAILABLE', '접수 시작 설정이 완료되지 않았습니다. 운영 담당자에게 문의해주세요.');
  }

  // 글자 수는 사용자가 보낸 값이 아니라 서버가 다시 센다.
  const checked = checkMessage(input.message, campaign.max_message_length);

  const publication = await loadPublishedContent(env, campaign.id, 'SUBMISSION');
  const publishedBody = JSON.parse(publication.body_json) as { blocks: import('@first-seat/domain').ContentBlock[] };
  const retentionUntil = now + retentionDays(publishedBody.blocks) * 24 * 60 * 60 * 1000;

  const requiredPolicyIds = input.consentPolicyIds;
  if (requiredPolicyIds.length === 0) {
    throw new DomainError('UNPROCESSABLE', '필수 동의가 필요합니다.');
  }
  const policyPlaceholders = requiredPolicyIds.map(() => '?').join(',');

  const windowStart = Math.floor(now / SUBMISSION_RATE_WINDOW_MS) * SUBMISSION_RATE_WINDOW_MS;
  const guardCampaign = newId();
  const guardContent = newId();
  const guardConsent = newId();
  const guardRate = newId();
  const auditId = newId();

  const statements: D1PreparedStatement[] = [
    // 1. 캠페인 상태·기간·revision·글자수 상한을 변경 직전에 다시 확인한다.
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
         SELECT 1 FROM campaigns c
          WHERE c.id = ? AND c.state = 'SUBMISSION_OPEN' AND c.paused = 0 AND c.launch_approved = 1
            AND c.revision = ?
            AND (c.submission_start IS NULL OR c.submission_start <= ?)
            AND (c.submission_end IS NULL OR c.submission_end > ?)
            AND c.max_message_length >= ?
       ) THEN 1 ELSE 0 END)`,
    ).bind(
      guardCampaign,
      campaign.id,
      input.configRevision,
      now,
      now,
      checked.graphemeCount,
    ),
    // 2. 사용자가 본 콘텐츠 버전이 지금 게시본과 같은지 확인한다.
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
         SELECT 1 FROM content_publications p
          WHERE p.campaign_id = ? AND p.page = 'SUBMISSION' AND p.locale = 'ko'
            AND p.content_version_id = ?
       ) THEN 1 ELSE 0 END)`,
    ).bind(guardContent, campaign.id, input.contentVersionId),
    // 3. 필수 동의 완비. 보낸 policy가 이 캠페인의 필수 정책 전부를 덮어야 한다.
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN
         (SELECT COUNT(DISTINCT cp.kind) FROM campaign_policies cp
          JOIN policy_documents d ON d.id = cp.policy_id
          WHERE cp.campaign_id = ? AND cp.required = 1
            AND cp.kind IN ('PRIVACY', 'WORK_LICENSE') AND length(trim(d.body)) > 0) = 2
         AND (SELECT COUNT(*) FROM campaign_policies WHERE campaign_id = ? AND required = 1)
         =
         (SELECT COUNT(*) FROM campaign_policies
           WHERE campaign_id = ? AND required = 1 AND policy_id IN (${policyPlaceholders}))
       THEN 1 ELSE 0 END)`,
    ).bind(guardConsent, campaign.id, campaign.id, campaign.id, ...requiredPolicyIds),
    // 4. 원자적 rate bucket 증가 후 한도 확인.
    env.DB.prepare(
      `INSERT INTO rate_buckets(scope, subject_hmac, window_start, count, expires_at)
       VALUES ('submission', ?, ?, 1, ?)
       ON CONFLICT(scope, subject_hmac, window_start)
       DO UPDATE SET count = count + 1`,
    ).bind(([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, windowStart + SUBMISSION_RATE_WINDOW_MS * 2),
    env.DB.prepare(
      `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN (
         SELECT count FROM rate_buckets
          WHERE scope = 'submission' AND subject_hmac = ? AND window_start = ?
       ) <= ? THEN 1 ELSE 0 END)`,
    ).bind(guardRate, ([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, SUBMISSION_RATE_LIMIT),
    // 5. 멱등 기록. 동시 요청은 PK 충돌로 전체 batch가 rollback된다.
    env.DB.prepare(
      `INSERT INTO idempotency_records(scope, session_hash, key_hash, request_hmac, resource_id, http_status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 201, ?, ?)`,
    ).bind(
      IDEMPOTENCY_SCOPE,
      input.sessionHash,
      input.idempotencyKeyHash,
      input.requestHmac,
      input.submissionId,
      now,
      now + IDEMPOTENCY_TTL_MS,
    ),
    // 6. 접수. accepted_at은 서버 시각이며 클라이언트가 정하지 않는다.
    env.DB.prepare(
      `INSERT INTO submissions(id, campaign_id, config_revision, message, grapheme_count, accepted_at, status, reviewer_note, row_version, content_version_id)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', '', 1, ?)`,
    ).bind(
      input.submissionId,
      campaign.id,
      input.configRevision,
      checked.normalized,
      checked.graphemeCount,
      now,
      input.contentVersionId,
    ),
    env.DB.prepare(
      `INSERT INTO pii_contacts(submission_id, ciphertext, wrapped_dek, iv, key_version, aad_version, masked_name, masked_phone, masked_email, retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.submissionId,
      input.envelope.ciphertext,
      input.envelope.wrappedDek,
      input.envelope.iv,
      input.envelope.keyVersion,
      input.envelope.aadVersion,
      input.envelope.maskedName,
      input.envelope.maskedPhone,
      input.envelope.maskedEmail,
      retentionUntil,
      now,
    ),
  ];

  for (const policyId of requiredPolicyIds) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO consent_receipts(submission_id, policy_id, accepted_at) VALUES (?, ?, ?)`,
      ).bind(input.submissionId, policyId, now),
    );
  }

  statements.push(
    // 7. audit. 문구·연락처·token은 남기지 않는다.
    env.DB.prepare(
      `INSERT INTO audit_events(id, actor_id, action, target_type, target_id, occurred_at, outcome, request_id, metadata_json, retention_until)
       VALUES (?, NULL, 'SUBMISSION_ACCEPTED', 'submission', ?, ?, 'SUCCESS', ?, ?, ?)`,
    ).bind(
      auditId,
      input.submissionId,
      now,
      input.requestId,
      JSON.stringify({ configRevision: input.configRevision, contentVersionId: input.contentVersionId }),
      now + 365 * 24 * 60 * 60 * 1000,
    ),
    env.DB.prepare(
      `INSERT INTO audit_outbox(event_id, r2_key, attempts, storage_backend) VALUES (?, ?, 0, 'D1')`,
    ).bind(auditId, auditRecordKey(now, auditId)),
    env.DB.prepare(`DELETE FROM operation_guards WHERE id IN (?, ?, ?, ?)`).bind(
      guardCampaign,
      guardContent,
      guardConsent,
      guardRate,
    ),
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('SUBMISSION_GATE')) {
      throw new DomainError('SUBMISSION_GATE', '지금은 접수할 수 없습니다.');
    }
    if (text.includes('CHECK constraint failed: ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '접수 조건이 변경되었습니다. 페이지를 새로고침해주세요.');
    }
    if (text.includes('UNIQUE constraint failed: idempotency_records')) {
      throw new DomainError('DUPLICATE_KEY', '이미 처리 중인 요청입니다.');
    }
    throw error;
  }

  return { status: 201, submissionId: input.submissionId };
}
