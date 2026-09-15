import { resetTestData } from './admin/reset.js';
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Campaign, CampaignState } from '@first-seat/domain';
import type { ContentBody, ContentPage } from '@first-seat/content';
import type { DataEnv } from './env.js';
import { buildCampaignDto, loadCampaign } from './campaign.js';
import { createSubmission, type CreateSubmissionInput, type CreateSubmissionResult } from './submissions.js';
import {
  castVote,
  getCandidates,
  getVoteStatus,
  issueVoterSession,
  type CandidatesView,
  type CastVoteInput,
  type CastVoteResult,
  type VoterSessionInput,
  type VoterSessionResult,
  type VoteStatus,
} from './votes.js';
import { getPublishedResult, type PublicResult } from './public-result.js';
import { toRpcResult, type RpcResult } from './result-rpc.js';
import { loadAdmin, provisionAdmin, type AdminIdentity } from './admin/common.js';
import { ensureAdminSession } from './admin/session.js';
import {
  getSubmission,
  listSubmissions,
  updateSubmission,
  type ListSubmissionsInput,
  type ReviewList,
  type ReviewUpdateInput,
  type SubmissionDetail,
} from './admin/review.js';
import {
  consumeRevealGrant,
  createRevealGrant,
  getMask,
  recordRevealOutcome,
  type MaskView,
  type RevealCiphertext,
  type RevealInput,
  type StepUpInput,
} from './admin/pii.js';
import {
  confirmShortlist,
  getShortlist,
  reorderShortlist,
  type ShortlistView,
} from './admin/shortlist.js';
import {
  appendDecision,
  getMonitor,
  listRisks,
  type DecisionInput,
  type MonitorView,
  type RiskRow,
} from './admin/monitor.js';
import {
  getEditor,
  previewFields,
  saveField,
  saveFields,
  type ContentEditorView,
  type FieldSaveInput,
  type FieldsSaveInput,
} from './admin/content.js';
import {
  commitTransition,
  getCampaignAdmin,
  previewTransition,
  setPaused,
  updateConfig,
  type CampaignAdminView,
  type CampaignConfigInput,
  type TransitionPreview,
} from './admin/campaign.js';
import {
  confirmFinalMessage,
  getFinalSelection,
  getVoteRanking,
  putResultMedia,
  type FinalSelection,
  type MediaInput,
  type VoteRanking,
} from './admin/result.js';
import { listAudit, type AuditList } from './admin/audit.js';
import {
  activatePolicy,
  approvePolicy,
  createPolicy,
  listPolicies,
  type PolicyKind,
  type PolicyView,
} from './admin/policy.js';
import {
  createDeletionJob,
  getDeletionJob,
  type DeletionKind,
  type DeletionStatus,
} from './admin/deletion.js';
import { runScheduled, type CronSummary } from './jobs.js';
import { getDashboard, type DashboardView } from './admin/dashboard.js';
import {
  executeAction,
  previewAction,
  type ActionPreview,
  type CampaignActionKind,
} from './admin/actions.js';

/**
 * Data Worker. D1 binding을 가진 유일한 서비스이며 외부 route를 갖지 않는다.
 * PII 개인키는 이 Worker에 주지 않는다. 범용 SQL RPC도 제공하지 않으며 메서드는 고정되어 있다.
 */

export class PublicData extends WorkerEntrypoint<DataEnv> {
  async getCampaign(slug: string, page: ContentPage | null): Promise<RpcResult<Campaign>> {
    return toRpcResult(() => buildCampaignDto(this.env, slug, page));
  }

  /** 투표 epoch만 돌려주는 최소 조회. session bootstrap이 콘텐츠 게시 여부에 묶이지 않게 한다. */
  async getEpoch(slug: string): Promise<RpcResult<number>> {
    return toRpcResult(async () => {
      const row = await loadCampaign(this.env, slug);
      return row.voting_epoch;
    });
  }

  async submit(input: CreateSubmissionInput): Promise<RpcResult<CreateSubmissionResult>> {
    return toRpcResult(() => createSubmission(this.env, input));
  }

  async issueVoterSession(input: VoterSessionInput): Promise<RpcResult<VoterSessionResult>> {
    return toRpcResult(() => issueVoterSession(this.env, input));
  }

  async getVoteStatus(slug: string, tokenHash: string | null): Promise<RpcResult<VoteStatus>> {
    return toRpcResult(() => getVoteStatus(this.env, slug, tokenHash));
  }

  async getCandidates(slug: string): Promise<RpcResult<CandidatesView>> {
    return toRpcResult(() => getCandidates(this.env, slug));
  }

  async castVote(input: CastVoteInput): Promise<RpcResult<CastVoteResult>> {
    return toRpcResult(() => castVote(this.env, input));
  }

  async getResult(slug: string): Promise<RpcResult<PublicResult>> {
    return toRpcResult(() => getPublishedResult(this.env, slug));
  }
}

/**
 * Admin RPC. Access JWT는 Admin Worker가 검증하고 여기서 subject로 다시 역할을 조회한다.
 * Public Worker는 이 entrypoint에 binding되지 않는다.
 */
export class AdminData extends WorkerEntrypoint<DataEnv> {
  private async admin(subject: string): Promise<AdminIdentity> {
    return loadAdmin(this.env, subject);
  }

  async whoami(subject: string): Promise<RpcResult<AdminIdentity>> {
    return toRpcResult(() => this.admin(subject));
  }

  /**
   * 인증된 회사 계정을 처음 보면 운영자로 등록한다.
   * 비활성 계정은 다시 살리지 않는다.
   */
  async ensureAdministrator(
    provider: string,
    subject: string,
    email: string,
  ): Promise<RpcResult<{ accessSubject: string }>> {
    return toRpcResult(async () => {
      await provisionAdmin(this.env, { provider, subject, email });
      return { accessSubject: `${provider}:${subject}` };
    });
  }

  /** 서버 session을 만들거나 갱신하고 session id를 돌려준다. reveal grant가 여기에 묶인다. */
  async ensureSession(subject: string, sessionHash: string): Promise<RpcResult<{ sessionId: string }>> {
    return toRpcResult(async () => ({
      sessionId: await ensureAdminSession(this.env, await this.admin(subject), sessionHash),
    }));
  }

  /** 대시보드 요약. 개인정보를 담지 않는다. */
  async dashboard(subject: string, slug: string): Promise<RpcResult<DashboardView>> {
    return toRpcResult(async () => getDashboard(this.env, await this.admin(subject), slug));
  }

  async resetCampaignTestData(subject: string, slug: string, revision: number, resetId: string, confirmation: string, requestId: string): Promise<RpcResult<{revision:number}>> {
    return toRpcResult(async () => resetTestData(this.env, await this.admin(subject), slug, revision, resetId, confirmation, requestId));
  }

  async previewCampaignAction(
    subject: string,
    slug: string,
    action: CampaignActionKind,
  ): Promise<RpcResult<ActionPreview>> {
    return toRpcResult(async () => previewAction(this.env, await this.admin(subject), slug, action));
  }

  /** 확인 한 번으로 공개 전환을 실행한다. */
  async executeCampaignAction(
    subject: string,
    slug: string,
    action: CampaignActionKind,
    idempotencyKey: string,
    expectedRevision: number,
    expectedSnapshotDigest: string,
    requestId: string,
  ): Promise<RpcResult<{ state: string; revision: number; actionId: string }>> {
    return toRpcResult(async () =>
      executeAction(
        this.env,
        await this.admin(subject),
        slug,
        action,
        idempotencyKey,
        expectedRevision,
        expectedSnapshotDigest,
        requestId,
      ),
    );
  }

  async campaign(subject: string, slug: string): Promise<RpcResult<CampaignAdminView>> {
    return toRpcResult(async () => getCampaignAdmin(this.env, await this.admin(subject), slug));
  }

  async listSubmissions(subject: string, input: ListSubmissionsInput): Promise<RpcResult<ReviewList>> {
    return toRpcResult(async () => listSubmissions(this.env, await this.admin(subject), input));
  }

  async getSubmission(subject: string, id: string): Promise<RpcResult<SubmissionDetail>> {
    return toRpcResult(async () => getSubmission(this.env, await this.admin(subject), id));
  }

  async updateSubmission(subject: string, input: ReviewUpdateInput): Promise<RpcResult<{ rowVersion: number }>> {
    return toRpcResult(async () => updateSubmission(this.env, await this.admin(subject), input));
  }

  async getMask(subject: string, id: string, requestId: string): Promise<RpcResult<MaskView>> {
    return toRpcResult(async () => getMask(this.env, await this.admin(subject), id, requestId));
  }

  async createRevealGrant(
    subject: string,
    input: StepUpInput,
  ): Promise<RpcResult<{ grantId: string; expiresAt: number }>> {
    return toRpcResult(async () => createRevealGrant(this.env, await this.admin(subject), input));
  }

  async consumeRevealGrant(subject: string, input: RevealInput): Promise<RpcResult<RevealCiphertext>> {
    return toRpcResult(async () => consumeRevealGrant(this.env, await this.admin(subject), input));
  }

  async recordRevealOutcome(
    subject: string,
    submissionId: string,
    requestId: string,
    outcome: 'SUCCESS' | 'FAILED',
  ): Promise<RpcResult<null>> {
    return toRpcResult(async () => {
      await recordRevealOutcome(this.env, await this.admin(subject), submissionId, requestId, outcome);
      return null;
    });
  }

  /** 숏리스트. 심사에서 후보로 지정한 문구가 자동으로 들어온다. */
  async getShortlist(subject: string, slug: string): Promise<RpcResult<ShortlistView>> {
    return toRpcResult(async () => getShortlist(this.env, await this.admin(subject), slug));
  }

  async reorderShortlist(
    subject: string,
    slug: string,
    orderedIds: readonly string[],
    requestId: string,
  ): Promise<RpcResult<ShortlistView>> {
    return toRpcResult(async () => reorderShortlist(this.env, await this.admin(subject), slug, orderedIds, requestId));
  }

  async confirmShortlist(
    subject: string,
    slug: string,
    expectedPreparedDigest: string,
    requestId: string,
  ): Promise<RpcResult<ShortlistView>> {
    return toRpcResult(async () =>
      confirmShortlist(this.env, await this.admin(subject), slug, expectedPreparedDigest, requestId),
    );
  }

  /** 투표 현황. 집계 포함 득표 내림차순. */
  async voteRanking(subject: string, slug: string): Promise<RpcResult<VoteRanking>> {
    return toRpcResult(async () => getVoteRanking(this.env, await this.admin(subject), slug));
  }

  /** 캠페인 설정 저장. 일정·문구 길이를 바꾼다. */
  async updateConfig(subject: string, input: CampaignConfigInput): Promise<RpcResult<{ revision: number }>> {
    return toRpcResult(async () => updateConfig(this.env, await this.admin(subject), input));
  }

  /** 긴급 일시 중단과 해제. */
  async setPaused(
    subject: string,
    slug: string,
    paused: boolean,
    requestId: string,
  ): Promise<RpcResult<{ paused: boolean }>> {
    return toRpcResult(async () => setPaused(this.env, await this.admin(subject), slug, paused, requestId));
  }

  /** 투표 집계 현황. */
  async monitor(subject: string, slug: string): Promise<RpcResult<MonitorView>> {
    return toRpcResult(async () => getMonitor(this.env, await this.admin(subject), slug));
  }

  /** 이상 징후가 있는 표 목록. */
  async risks(subject: string, slug: string, state: string | null): Promise<RpcResult<readonly RiskRow[]>> {
    return toRpcResult(async () => listRisks(this.env, await this.admin(subject), slug, state));
  }

  /** 표 판정 기록. append-only이며 원표 값을 바꾸지 않는다. */
  async appendDecision(subject: string, input: DecisionInput): Promise<RpcResult<{ version: number }>> {
    return toRpcResult(async () => appendDecision(this.env, await this.admin(subject), input));
  }

  async finalSelection(subject: string, slug: string): Promise<RpcResult<FinalSelection | null>> {
    return toRpcResult(async () => getFinalSelection(this.env, await this.admin(subject), slug));
  }

  async confirmFinalMessage(
    subject: string,
    slug: string,
    candidateId: string,
    expectedCurrentResultId: string,
    requestId: string,
  ): Promise<RpcResult<FinalSelection>> {
    return toRpcResult(async () =>
      confirmFinalMessage(
        this.env,
        await this.admin(subject),
        slug,
        candidateId,
        expectedCurrentResultId,
        requestId,
      ),
    );
  }

  async putResultMedia(
    subject: string,
    id: string,
    media: readonly MediaInput[],
    requestId: string,
  ): Promise<RpcResult<{ count: number }>> {
    return toRpcResult(async () => putResultMedia(this.env, await this.admin(subject), id, media, requestId));
  }

  /** 화면 문구. 항목을 바로 고치고 저장한다. */
  async contentEditor(subject: string, slug: string, page: ContentPage): Promise<RpcResult<ContentEditorView>> {
    return toRpcResult(async () => getEditor(this.env, await this.admin(subject), slug, page));
  }

  async saveContentField(
    subject: string,
    slug: string,
    input: FieldSaveInput,
  ): Promise<RpcResult<ContentEditorView>> {
    return toRpcResult(async () => saveField(this.env, await this.admin(subject), slug, input));
  }

  /** 여러 항목을 한 버전으로 함께 저장한다. */
  async saveContentFields(subject: string, slug: string, input: FieldsSaveInput): Promise<RpcResult<ContentEditorView>> {
    return toRpcResult(async () => saveFields(this.env, await this.admin(subject), slug, input));
  }

  async previewContentFields(
    subject: string,
    slug: string,
    page: ContentPage,
    fields: readonly { key: string; text?: string; items?: readonly string[] }[],
  ): Promise<RpcResult<unknown>> {
    return toRpcResult(async () => previewFields(this.env, await this.admin(subject), slug, page, fields));
  }

  async listAudit(
    subject: string,
    filters: { action: string | null; targetId: string | null; cursor: string | null; limit: number | null },
  ): Promise<RpcResult<AuditList>> {
    return toRpcResult(async () => listAudit(this.env, await this.admin(subject), filters));
  }

  async listPolicies(subject: string, slug: string): Promise<RpcResult<readonly PolicyView[]>> {
    return toRpcResult(async () => listPolicies(this.env, await this.admin(subject), slug));
  }

  async createPolicy(
    subject: string,
    slug: string,
    kind: PolicyKind,
    body: string,
    requestId: string,
  ): Promise<RpcResult<PolicyView>> {
    return toRpcResult(async () => createPolicy(this.env, await this.admin(subject), slug, kind, body, requestId));
  }

  async approvePolicy(subject: string, id: string, requestId: string): Promise<RpcResult<{ approvalId: string }>> {
    return toRpcResult(async () => approvePolicy(this.env, await this.admin(subject), id, requestId));
  }

  async activatePolicy(
    subject: string,
    slug: string,
    id: string,
    required: boolean,
    requestId: string,
  ): Promise<RpcResult<null>> {
    return toRpcResult(async () => {
      await activatePolicy(this.env, await this.admin(subject), slug, id, required, requestId);
      return null;
    });
  }

  async createDeletionJob(
    subject: string,
    slug: string,
    targetId: string,
    kind: DeletionKind,
    reason: string,
    requestId: string,
  ): Promise<RpcResult<{ id: string }>> {
    return toRpcResult(async () =>
      createDeletionJob(this.env, await this.admin(subject), slug, targetId, kind, reason, requestId),
    );
  }

  async getDeletionJob(subject: string, id: string): Promise<RpcResult<DeletionStatus>> {
    return toRpcResult(async () => getDeletionJob(this.env, await this.admin(subject), id));
  }

  /** 로컬·검증용 수동 실행. 운영에서는 Cron이 같은 함수를 호출한다. */
  async runJobs(subject: string): Promise<RpcResult<CronSummary>> {
    return toRpcResult(async () => {
      await this.admin(subject);
      return runScheduled(this.env);
    });
  }
}

export default {
  /** 외부에서 직접 호출되면 어떤 경로든 403. service binding RPC만 허용한다. */
  fetch(): Response {
    return new Response('forbidden', { status: 403 });
  },
  async scheduled(_event: ScheduledController, env: DataEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env).then(() => undefined));
  },
} satisfies ExportedHandler<DataEnv>;
