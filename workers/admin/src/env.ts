import type { ContentPage } from '@first-seat/content';

export interface RpcFail {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: readonly { field: string; message: string }[];
}
export type RpcResult<T> = { readonly ok: true; readonly value: T } | RpcFail;

export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
}

export interface RevealCiphertext {
  readonly campaignId: string;
  readonly ciphertext: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: string;
  readonly aadVersion: number;
}

/** Data Worker의 AdminData entrypoint. 고정 메서드만 노출되며 범용 SQL은 없다. */
export interface AdminDataService {
  whoami(subject: string): Promise<RpcResult<AdminIdentity>>;
  ensureAdministrator(
    provider: string,
    subject: string,
    email: string,
  ): Promise<RpcResult<{ accessSubject: string }>>;
  ensureSession(subject: string, sessionHash: string): Promise<RpcResult<{ sessionId: string }>>;
  dashboard(subject: string, slug: string): Promise<RpcResult<unknown>>;
  campaign(subject: string, slug: string): Promise<RpcResult<unknown>>;
  updateConfig(subject: string, input: unknown): Promise<RpcResult<unknown>>;
  setPaused(subject: string, slug: string, paused: boolean, requestId: string): Promise<RpcResult<unknown>>;

  previewCampaignAction(subject: string, slug: string, action: string): Promise<RpcResult<unknown>>;
  resetCampaignTestData(subject: string, slug: string, revision: number, resetId: string, confirmation: string, requestId: string): Promise<RpcResult<unknown>>;
  executeCampaignAction(
    subject: string,
    slug: string,
    action: string,
    idempotencyKey: string,
    expectedRevision: number,
    expectedSnapshotDigest: string,
    requestId: string,
  ): Promise<RpcResult<unknown>>;

  listSubmissions(subject: string, input: unknown): Promise<RpcResult<unknown>>;
  getSubmission(subject: string, id: string): Promise<RpcResult<unknown>>;
  updateSubmission(subject: string, input: unknown): Promise<RpcResult<unknown>>;

  getShortlist(subject: string, slug: string): Promise<RpcResult<unknown>>;
  reorderShortlist(
    subject: string,
    slug: string,
    orderedIds: readonly string[],
    requestId: string,
  ): Promise<RpcResult<unknown>>;
  confirmShortlist(
    subject: string,
    slug: string,
    expectedPreparedDigest: string,
    requestId: string,
  ): Promise<RpcResult<unknown>>;

  voteRanking(subject: string, slug: string): Promise<RpcResult<unknown>>;
  monitor(subject: string, slug: string): Promise<RpcResult<unknown>>;
  risks(subject: string, slug: string, state: string | null): Promise<RpcResult<unknown>>;
  appendDecision(subject: string, input: unknown): Promise<RpcResult<unknown>>;

  finalSelection(subject: string, slug: string): Promise<RpcResult<unknown>>;
  confirmFinalMessage(
    subject: string,
    slug: string,
    candidateId: string,
    expectedCurrentResultId: string,
    requestId: string,
  ): Promise<RpcResult<unknown>>;
  putResultMedia(subject: string, id: string, media: unknown, requestId: string): Promise<RpcResult<unknown>>;

  contentEditor(subject: string, slug: string, page: ContentPage): Promise<RpcResult<unknown>>;
  saveContentField(subject: string, slug: string, input: unknown): Promise<RpcResult<unknown>>;
  saveContentFields(subject: string, slug: string, input: unknown): Promise<RpcResult<unknown>>;
  previewContentFields(
    subject: string,
    slug: string,
    page: ContentPage,
    fields: readonly { key: string; text?: string; items?: readonly string[] }[],
  ): Promise<RpcResult<unknown>>;

  getMask(subject: string, id: string, requestId: string): Promise<RpcResult<unknown>>;
  createRevealGrant(subject: string, input: unknown): Promise<RpcResult<{ grantId: string; expiresAt: number }>>;
  consumeRevealGrant(subject: string, input: unknown): Promise<RpcResult<RevealCiphertext>>;
  recordRevealOutcome(
    subject: string,
    submissionId: string,
    requestId: string,
    outcome: 'SUCCESS' | 'FAILED',
  ): Promise<RpcResult<null>>;

  listAudit(subject: string, filters: unknown): Promise<RpcResult<unknown>>;
  listPolicies(subject: string, slug: string): Promise<RpcResult<unknown>>;
  createDeletionJob(
    subject: string,
    slug: string,
    targetId: string,
    kind: string,
    reason: string,
    requestId: string,
  ): Promise<RpcResult<unknown>>;
  getDeletionJob(subject: string, id: string): Promise<RpcResult<unknown>>;
  runJobs(subject: string): Promise<RpcResult<unknown>>;
}

export interface AdminEnv {
  // ASSETS binding은 없다. Admin 화면은 Vercel이 서빙한다.
  readonly DATA: AdminDataService;
  readonly ENVIRONMENT: string;
  readonly CAMPAIGN_SLUG: string;
  /** Admin 화면(Vercel) 출처 허용 목록. 브라우저 요청의 CSRF 검사에 쓴다. */
  readonly ALLOWED_ORIGINS: string;
  /** 'dev'면 서명 없이 개발 헤더로 인증한다. production에서는 쓸 수 없다. */
  readonly GATEWAY_MODE: string;
  /** 중계 서버와 나눠 가진 요청 서명 비밀값. */
  readonly GATEWAY_SECRET: string;
  readonly SESSION_SECRET: string;
  readonly PII_PRIVATE_KEY: string;
}

export function allowedOrigins(env: AdminEnv): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
