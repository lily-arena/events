import { DomainError } from '@first-seat/domain';
import { IDEMPOTENCY_TTL_MS } from '@first-seat/security';
import type { DataEnv } from './env.js';
import type { IdempotencyRow } from './rows.js';
import { auditRecordKey, newId } from './ids.js';
import { loadCampaign } from './campaign.js';

/**
 * 투표. 서버 발급 voter session당 한 표이며 본인인증을 쓰지 않는다.
 * 사람 단위 완벽한 1인 1표를 보장하지 않으며 내부 수치는 '표'로 표현한다.
 */

/** 초기 기준값. 공유 NAT 테스트와 실제 D1 rows 측정으로 확정한다. */
const VOTE_RATE_WINDOW_MS = 5 * 60 * 1000;
const VOTE_RATE_LIMIT_PER_SESSION = 10;
const IP_OBSERVE_THRESHOLD = 60;
const IP_BLOCK_THRESHOLD = 300;
const VOTER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RISK_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_SCOPE = 'vote';

export interface VoterSessionInput {
  readonly campaignSlug: string;
  readonly tokenHash: string;
  readonly rateSubjectHmac: string;
  readonly requestId: string;
}

export interface VoterSessionResult {
  readonly sessionId: string;
  readonly epoch: number;
  readonly expiresAt: number;
}

export async function issueVoterSession(
  env: DataEnv,
  input: VoterSessionInput,
): Promise<VoterSessionResult> {
  const campaign = await loadCampaign(env, input.campaignSlug);
  if (campaign.state !== 'VOTING_OPEN' || campaign.paused === 1) {
    throw new DomainError('CONFLICT', '지금은 투표에 참여할 수 없습니다.');
  }
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id, epoch, expires_at FROM anonymous_sessions
      WHERE token_hash = ? AND purpose = 'VOTER' AND campaign_id = ?`,
  )
    .bind(input.tokenHash, campaign.id)
    .first<{ id: string; epoch: number; expires_at: number }>();
  // 유효한 기존 session은 그대로 쓴다. epoch가 다르거나 만료면 새로 발급한다.
  if (existing !== null && existing.epoch === campaign.voting_epoch && existing.expires_at > now) {
    return { sessionId: existing.id, epoch: existing.epoch, expiresAt: existing.expires_at };
  }

  const sessionId = newId();
  const expiresAt = now + VOTER_SESSION_TTL_MS;
  const windowStart = Math.floor(now / VOTE_RATE_WINDOW_MS) * VOTE_RATE_WINDOW_MS;
  const guardRate = newId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rate_buckets(scope, subject_hmac, window_start, count, expires_at)
         VALUES ('voter_session', ?, ?, 1, ?)
         ON CONFLICT(scope, subject_hmac, window_start) DO UPDATE SET count = count + 1`,
      ).bind(([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, windowStart + VOTE_RATE_WINDOW_MS * 2),
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN (
           SELECT count FROM rate_buckets WHERE scope = 'voter_session' AND subject_hmac = ? AND window_start = ?
         ) <= ? THEN 1 ELSE 0 END)`,
      ).bind(guardRate, ([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, IP_BLOCK_THRESHOLD),
      env.DB.prepare(
        `INSERT INTO anonymous_sessions(id, campaign_id, purpose, epoch, token_hash, issued_at, expires_at)
         VALUES (?, ?, 'VOTER', ?, ?, ?, ?)`,
      ).bind(sessionId, campaign.id, campaign.voting_epoch, input.tokenHash, now, expiresAt),
      env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardRate),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('RATE_LIMITED', '잠시 후 다시 시도해주세요.');
    }
    throw error;
  }
  return { sessionId, epoch: campaign.voting_epoch, expiresAt };
}

export interface VoteStatus {
  readonly epoch: number;
  readonly voted: boolean;
}

export async function getVoteStatus(env: DataEnv, campaignSlug: string, tokenHash: string | null): Promise<VoteStatus> {
  const campaign = await loadCampaign(env, campaignSlug);
  if (tokenHash === null) return { epoch: campaign.voting_epoch, voted: false };
  const row = await env.DB.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM votes v
        JOIN anonymous_sessions a ON a.id = v.voter_session_id
       WHERE a.token_hash = ? AND v.campaign_id = ? AND v.epoch = ?
     ) AS voted`,
  )
    .bind(tokenHash, campaign.id, campaign.voting_epoch)
    .first<{ voted: number }>();
  return { epoch: campaign.voting_epoch, voted: (row?.voted ?? 0) === 1 };
}

export interface PublicCandidate {
  readonly id: string;
  readonly number: number;
  readonly message: string;
}

export interface CandidatesView {
  readonly epoch: number;
  readonly setId: string;
  readonly setRevision: number;
  readonly candidates: readonly PublicCandidate[];
}

export async function getCandidates(env: DataEnv, campaignSlug: string): Promise<CandidatesView> {
  const campaign = await loadCampaign(env, campaignSlug);
  const set = await env.DB.prepare(
    `SELECT id, revision FROM candidate_sets
      WHERE campaign_id = ? AND epoch = ? AND status = 'FROZEN'`,
  )
    .bind(campaign.id, campaign.voting_epoch)
    .first<{ id: string; revision: number }>();
  if (set === null) throw new DomainError('UNAVAILABLE', '후보를 준비하고 있습니다.');

  const rows = await env.DB.prepare(
    `SELECT id, public_number, public_message FROM candidates
      WHERE set_id = ? ORDER BY display_order`,
  )
    .bind(set.id)
    .all<{ id: string; public_number: number; public_message: string }>();

  // 응모자 정보·심사 note·득표율은 Public DTO에 넣지 않는다.
  return {
    epoch: campaign.voting_epoch,
    setId: set.id,
    setRevision: set.revision,
    candidates: rows.results.map((row) => ({
      id: row.id,
      number: row.public_number,
      message: row.public_message,
    })),
  };
}

export interface CastVoteInput {
  readonly campaignSlug: string;
  readonly tokenHash: string;
  readonly candidateId: string;
  readonly setId: string;
  readonly idempotencyKeyHash: string;
  readonly requestHmac: string;
  readonly requestId: string;
  readonly ipHmac: string;
  readonly ipKeyVersion: string;
  readonly clientClass: string;
  readonly rateSubjectHmac: string;
}

export interface CastVoteResult {
  readonly status: 200 | 201;
  readonly voteId: string;
}

export async function castVote(env: DataEnv, input: CastVoteInput): Promise<CastVoteResult> {
  const campaign = await loadCampaign(env, input.campaignSlug);
  const now = Date.now();

  const session = await env.DB.prepare(
    `SELECT id, epoch, expires_at FROM anonymous_sessions
      WHERE token_hash = ? AND purpose = 'VOTER' AND campaign_id = ?`,
  )
    .bind(input.tokenHash, campaign.id)
    .first<{ id: string; epoch: number; expires_at: number }>();
  if (session === null || session.epoch !== campaign.voting_epoch || session.expires_at <= now) {
    // 임의 token·다른 epoch·만료는 재발급 절차로 보낸다.
    throw new DomainError('UNAUTHENTICATED', '투표 참여 정보를 다시 확인해주세요.');
  }

  const prior = await env.DB.prepare(
    `SELECT request_hmac, resource_id, http_status FROM idempotency_records
      WHERE scope = ? AND session_hash = ? AND key_hash = ? AND expires_at > ?`,
  )
    .bind(IDEMPOTENCY_SCOPE, input.tokenHash, input.idempotencyKeyHash, now)
    .first<IdempotencyRow>();
  if (prior !== null) {
    if (prior.request_hmac !== input.requestHmac) {
      throw new DomainError('DUPLICATE_KEY', '같은 요청 key로 다른 내용이 전송되었습니다.');
    }
    return { status: 200, voteId: prior.resource_id };
  }

  const already = await env.DB.prepare(
    `SELECT 1 AS found FROM votes WHERE campaign_id = ? AND epoch = ? AND voter_session_id = ?`,
  )
    .bind(campaign.id, campaign.voting_epoch, session.id)
    .first<{ found: number }>();
  if (already !== null) throw new DomainError('ALREADY_VOTED', '이미 투표에 참여하셨습니다.');

  // 같은 IP HMAC의 최근 표 수만 본다. 같은 네트워크라는 이유만으로 제외하지 않는다.
  const ipRecent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM vote_risk_signals r
      JOIN votes v ON v.id = r.vote_id
     WHERE r.ip_hmac = ? AND v.campaign_id = ? AND v.epoch = ? AND v.accepted_at > ?`,
  )
    .bind(input.ipHmac, campaign.id, campaign.voting_epoch, now - VOTE_RATE_WINDOW_MS)
    .first<{ n: number }>();
  const ipCount = ipRecent?.n ?? 0;

  const reasons: string[] = [];
  if (ipCount >= IP_OBSERVE_THRESHOLD) reasons.push('IP_BURST');
  if (input.clientClass === 'unknown') reasons.push('UNKNOWN_CLIENT');
  // 위험 신호가 있으면 PENDING으로 저장하고 나중에 사람이 판정한다. 표를 버리지 않는다.
  const initialState = reasons.length > 0 ? 'PENDING' : 'INCLUDED';

  const voteId = newId();
  const auditId = newId();
  const windowStart = Math.floor(now / VOTE_RATE_WINDOW_MS) * VOTE_RATE_WINDOW_MS;
  const guardState = newId();
  const guardSet = newId();
  const guardRate = newId();

  try {
    await env.DB.batch([
      // 상태·기간·epoch·후보 set 동결 여부를 변경 직전에 재확인한다.
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM campaigns c
            WHERE c.id = ? AND c.state = 'VOTING_OPEN' AND c.paused = 0 AND c.launch_approved = 1
              AND c.voting_epoch = ?
              AND (c.voting_start IS NULL OR c.voting_start <= ?)
              AND (c.voting_end IS NULL OR c.voting_end > ?)
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardState, campaign.id, campaign.voting_epoch, now, now),
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN EXISTS(
           SELECT 1 FROM candidate_sets s
            JOIN candidates c ON c.set_id = s.id
            WHERE s.id = ? AND s.campaign_id = ? AND s.epoch = ? AND s.status = 'FROZEN' AND c.id = ?
         ) THEN 1 ELSE 0 END)`,
      ).bind(guardSet, input.setId, campaign.id, campaign.voting_epoch, input.candidateId),
      env.DB.prepare(
        `INSERT INTO rate_buckets(scope, subject_hmac, window_start, count, expires_at)
         VALUES ('vote', ?, ?, 1, ?)
         ON CONFLICT(scope, subject_hmac, window_start) DO UPDATE SET count = count + 1`,
      ).bind(([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, windowStart + VOTE_RATE_WINDOW_MS * 2),
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN (
           SELECT count FROM rate_buckets WHERE scope = 'vote' AND subject_hmac = ? AND window_start = ?
         ) <= ? THEN 1 ELSE 0 END)`,
      ).bind(guardRate, ([campaign.id, campaign.voting_epoch, input.rateSubjectHmac].join(':')), windowStart, VOTE_RATE_LIMIT_PER_SESSION),
      // UNIQUE(campaign_id, epoch, voter_session_id)가 동시 요청을 막는다.
      env.DB.prepare(
        `INSERT INTO votes(id, campaign_id, epoch, set_id, candidate_id, voter_session_id, accepted_at, initial_review_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(voteId, campaign.id, campaign.voting_epoch, input.setId, input.candidateId, session.id, now, initialState),
      env.DB.prepare(
        `INSERT INTO vote_risk_signals(vote_id, ip_hmac, key_version, client_class, reasons_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(voteId, input.ipHmac, input.ipKeyVersion, input.clientClass, JSON.stringify(reasons), now + RISK_RETENTION_MS),
      env.DB.prepare(
        `INSERT INTO idempotency_records(scope, session_hash, key_hash, request_hmac, resource_id, http_status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 201, ?, ?)`,
      ).bind(IDEMPOTENCY_SCOPE, input.tokenHash, input.idempotencyKeyHash, input.requestHmac, voteId, now, now + IDEMPOTENCY_TTL_MS),
      env.DB.prepare(
        `INSERT INTO audit_events(id, actor_id, action, target_type, target_id, occurred_at, outcome, request_id, metadata_json, retention_until)
         VALUES (?, NULL, 'VOTE_ACCEPTED', 'vote', ?, ?, 'SUCCESS', ?, ?, ?)`,
      ).bind(auditId, voteId, now, input.requestId, JSON.stringify({ epoch: campaign.voting_epoch, initialState }), now + 365 * 24 * 60 * 60 * 1000),
      env.DB.prepare(`INSERT INTO audit_outbox(event_id, r2_key, attempts, storage_backend) VALUES (?, ?, 0, 'D1')`).bind(
        auditId,
        auditRecordKey(now, auditId),
      ),
      env.DB.prepare(`DELETE FROM operation_guards WHERE id IN (?, ?, ?)`).bind(guardState, guardSet, guardRate),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('UNIQUE constraint failed: votes')) {
      throw new DomainError('ALREADY_VOTED', '이미 투표에 참여하셨습니다.');
    }
    if (text.includes('VOTE_GATE')) throw new DomainError('CONFLICT', '지금은 투표할 수 없습니다.');
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '투표 조건이 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    }
    if (text.includes('UNIQUE constraint failed: idempotency_records')) {
      throw new DomainError('DUPLICATE_KEY', '이미 처리 중인 요청입니다.');
    }
    throw error;
  }

  return { status: 201, voteId };
}
