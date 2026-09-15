import type { Campaign } from '@first-seat/domain';
import type { ContentPage } from '@first-seat/content';

export interface RpcOk<T> {
  readonly ok: true;
  readonly value: T;
}
export interface RpcFail {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: readonly { field: string; message: string }[];
}
export type RpcResult<T> = RpcOk<T> | RpcFail;

export interface SubmitRpcInput {
  campaignSlug: string;
  submissionId: string;
  message: string;
  configRevision: number;
  contentVersionId: string;
  consentPolicyIds: string[];
  envelope: {
    ciphertext: Uint8Array;
    wrappedDek: Uint8Array;
    iv: Uint8Array;
    keyVersion: string;
    aadVersion: number;
    maskedName: string;
    maskedPhone: string;
    maskedEmail: string;
  };
  sessionHash: string;
  idempotencyKeyHash: string;
  requestHmac: string;
  requestId: string;
  rateSubjectHmac: string;
}

export interface VoterSessionRpcInput {
  campaignSlug: string;
  tokenHash: string;
  rateSubjectHmac: string;
  requestId: string;
}

export interface CastVoteRpcInput {
  campaignSlug: string;
  tokenHash: string;
  candidateId: string;
  setId: string;
  idempotencyKeyHash: string;
  requestHmac: string;
  requestId: string;
  ipHmac: string;
  ipKeyVersion: string;
  clientClass: string;
  rateSubjectHmac: string;
}

export interface PublicCandidatesDto {
  epoch: number;
  setId: string;
  setRevision: number;
  candidates: readonly { id: string; number: number; message: string }[];
}

export interface PublicResultDto {
  version: number;
  winnerMessage: string;
  rationale: string;
  publishedAt: number;
  correctionNote: string | null;
  media: readonly { assetPath: string; alt: string; caption: string }[];
}

/** Data Worker의 PublicData entrypoint. 고정된 메서드만 노출된다. */
export interface PublicDataService {
  getCampaign(slug: string, page: ContentPage | null): Promise<RpcResult<Campaign>>;
  getEpoch(slug: string): Promise<RpcResult<number>>;
  submit(input: SubmitRpcInput): Promise<RpcResult<{ status: 200 | 201; submissionId: string }>>;
  issueVoterSession(
    input: VoterSessionRpcInput,
  ): Promise<RpcResult<{ sessionId: string; epoch: number; expiresAt: number }>>;
  getVoteStatus(slug: string, tokenHash: string | null): Promise<RpcResult<{ epoch: number; voted: boolean }>>;
  getCandidates(slug: string): Promise<RpcResult<PublicCandidatesDto>>;
  castVote(input: CastVoteRpcInput): Promise<RpcResult<{ status: 200 | 201; voteId: string }>>;
  getResult(slug: string): Promise<RpcResult<PublicResultDto>>;
}

export interface PublicEnv {
  // ASSETS binding은 없다. 화면은 Vercel이 서빙한다.
  readonly DATA: PublicDataService;
  readonly ENVIRONMENT: string;
  readonly CAMPAIGN_SLUG: string;
  /** 'dev'면 서명 없이 직접 호출을 허용한다. production에서는 쓸 수 없다. */
  readonly GATEWAY_MODE: string;
  /** 중계 서버와 나눠 가진 요청 서명 비밀값. */
  readonly GATEWAY_SECRET: string;
  /** 프런트(Vercel) 출처 허용 목록. CSRF 검사와 CORS 허용에 함께 쓴다. */
  readonly ALLOWED_ORIGINS: string;
  readonly ALLOWED_HOSTNAMES: string;
  readonly SESSION_SECRET: string;
  readonly IP_HMAC_KEY: string;
  readonly TURNSTILE_MODE: string;
  readonly TURNSTILE_SECRET: string;
  readonly TURNSTILE_SITE_KEY: string;
  readonly PII_PUBLIC_KEY: string;
  readonly PII_KEY_VERSION: string;
}

export function allowedOrigins(env: PublicEnv): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function allowedHostnames(env: PublicEnv): string[] {
  return env.ALLOWED_HOSTNAMES.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
