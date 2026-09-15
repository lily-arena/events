import { DomainError, PII_RETENTION_FIELD, parseRetentionDays, retentionDays } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import { seedFor, toPublicContent, validateBody, type ContentBody, type ContentPage } from '@first-seat/content';
import type { ContentBlock } from '@first-seat/domain';
import type { DataEnv } from '../env.js';
import { loadCampaign, loadPolicies } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';
import { newId } from '../ids.js';

/**
 * 화면 문구.
 * 초안 만들기·타인 승인·게시 절차를 두지 않는다. 담당자가 항목을 고치고 저장하면 끝난다.
 * 내부 버전과 이력은 서버가 자동으로 만든다.
 */

const PAGES: readonly ContentPage[] = ['SUBMISSION', 'SUBMITTED', 'VOTING', 'VOTED', 'WAITING', 'RESULT'];

/** 이 항목들이 바뀌면 법적 검토가 필요하다는 표시만 남긴다. 저장을 막지는 않는다. */
const POLICY_FIELDS = { privacy_body: 'PRIVACY', license_body: 'WORK_LICENSE' } as const;

const LEGAL_BLOCK_KEYS = ['notices', 'privacy_label', 'license_label', 'exclusions', 'entrant_helper'];

export interface EditableField {
  readonly key: string;
  readonly type: string;
  readonly label: string;
  readonly text: string | null;
  readonly items: readonly string[] | null;
  readonly legalReview: boolean;
}

export interface ContentEditorView {
  readonly page: ContentPage;
  readonly versionId: string | null;
  readonly version: number;
  readonly expectedVersion: number;
  readonly fields: readonly EditableField[];
  /** 지금 참여자에게 보이는 화면인지 */
  readonly live: boolean;
  readonly updatedAt: number | null;
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  hero: '큰 제목',
  intro: '소개 문단',
  headline: '안내 제목',
  lead: '안내 문장',
  back: '돌아가기 버튼',
  exclusion_heading: '제외 기준 제목',
  exclusions: '제외 기준 항목',
  message_label: '문구 입력 제목',
  message_helper: '문구 입력 도움말',
  entrant_heading: '응모자 정보 제목',
  entrant_helper: '응모자 정보 안내',
  privacy_label: '개인정보 동의 문구',
  license_label: '저작권 동의 문구',
  notices_heading: '유의사항 제목',
  notices: '유의사항 항목',
  submit: '제출 버튼',
  vote_submit: '투표 버튼',
  paused_headline: '일시 중단 제목',
  paused_body: '일시 중단 안내',
  waiting_submission_headline: '접수 준비 제목',
  waiting_submission_body: '접수 준비 안내',
  submission_closed_headline: '접수 종료 제목',
  submission_closed_body: '접수 종료 안내',
  waiting_voting_headline: '투표 준비 제목',
  waiting_voting_body: '투표 준비 안내',
  voting_closed_headline: '투표 종료 제목',
  voting_closed_body: '투표 종료 안내',
};

/** 현재 단계에서 참여자에게 보이는 페이지인지 */
function isLivePage(state: string, page: ContentPage): boolean {
  if (state === 'SUBMISSION_OPEN') return page === 'SUBMISSION' || page === 'SUBMITTED';
  if (state === 'VOTING_OPEN') return page === 'VOTING' || page === 'VOTED';
  if (state === 'RESULT_PUBLISHED' || state === 'ARCHIVED') return page === 'RESULT';
  return page === 'WAITING';
}

async function loadAppliedBody(env: DataEnv, campaignId: string, page: ContentPage): Promise<{
  versionId: string | null;
  version: number;
  body: ContentBody;
  updatedAt: number | null;
}> {
  const row = await env.DB.prepare(
    `SELECT v.id, v.version, v.body_json, v.updated_at
       FROM content_publications p JOIN content_versions v ON v.id = p.content_version_id
      WHERE p.campaign_id = ? AND p.page = ? AND p.locale = 'ko'`,
  )
    .bind(campaignId, page)
    .first<{ id: string; version: number; body_json: string; updated_at: number }>();

  if (row !== null) {
    return {
      versionId: row.id,
      version: row.version,
      body: JSON.parse(row.body_json) as ContentBody,
      updatedAt: row.updated_at,
    };
  }
  // 아직 저장된 내용이 없으면 기본 문구를 편집 가능한 상태로 보여준다.
  const seed = seedFor(page);
  return {
    versionId: null,
    version: 0,
    body: seed?.body ?? { blocks: [] },
    updatedAt: null,
  };
}

export async function getEditor(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  page: ContentPage,
): Promise<ContentEditorView> {
  requireRole(admin);
  if (!PAGES.includes(page)) throw new DomainError('BAD_REQUEST', '알 수 없는 화면입니다.');
  const campaign = await loadCampaign(env, campaignSlug);
  const applied = await loadAppliedBody(env, campaign.id, page);
  const policies = page === 'SUBMISSION' ? await loadPolicies(env, campaign.id) : [];

  return {
    page,
    versionId: applied.versionId,
    version: applied.version,
    expectedVersion: applied.version,
    fields: [...applied.body.blocks.filter((block) => block.key !== PII_RETENTION_FIELD).map((block) => ({
      key: block.key,
      type: block.type,
      label: FIELD_LABEL[block.key] ?? block.key,
      text: block.text ?? null,
      items: block.items ?? null,
      legalReview: LEGAL_BLOCK_KEYS.includes(block.key),
    })), ...(page === 'SUBMISSION' ? Object.entries(POLICY_FIELDS).map(([key, kind]) => ({
      key, type: 'policy', label: kind === 'PRIVACY' ? '개인정보 수집·이용 — 자세히 보기 본문' : '응모작 활용 — 자세히 보기 본문',
      text: policies.find((p) => p.kind === kind)?.body ?? '', items: null, legalReview: false,
    })) : []), ...(page === 'SUBMISSION' ? [{ key: PII_RETENTION_FIELD, type: 'number', label: '개인정보 보유기간 상한 (접수일부터 일수)', text: String(retentionDays(applied.body.blocks)), items: null, legalReview: false }] : [])],
    live: isLivePage(campaign.state, page),
    updatedAt: applied.updatedAt,
  };
}

export interface FieldPatch {
  readonly key: string;
  readonly text?: string;
  readonly items?: readonly string[];
}

export interface FieldSaveInput {
  readonly page: ContentPage;
  readonly key: string;
  readonly text?: string;
  readonly items?: readonly string[];
  /** 내가 보고 있던 버전. 다른 사람이 먼저 저장했으면 충돌로 알린다. */
  readonly expectedVersion: number;
  readonly requestId: string;
}

export interface FieldsSaveInput {
  readonly page: ContentPage;
  readonly fields: readonly FieldPatch[];
  /** 내가 보고 있던 버전. 다른 사람이 먼저 저장했으면 충돌로 알린다. */
  readonly expectedVersion: number;
  readonly requestId: string;
}

/**
 * 항목 하나를 저장한다. 여러 항목 저장의 특수한 경우로 처리한다.
 */
export async function saveField(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  input: FieldSaveInput,
): Promise<ContentEditorView> {
  const patch: FieldPatch =
    input.items !== undefined
      ? { key: input.key, items: input.items }
      : { key: input.key, text: input.text ?? '' };
  return saveFields(env, admin, campaignSlug, {
    page: input.page,
    fields: [patch],
    expectedVersion: input.expectedVersion,
    requestId: input.requestId,
  });
}

/**
 * 여러 항목을 한 번에 저장한다.
 *
 * 항목마다 따로 저장하면 첫 저장으로 버전이 올라가 나머지가 낡은 버전으로 충돌한다.
 * 그래서 바꾼 항목 전부를 한 버전·한 batch로 적용한다.
 * 다른 항목을 덮어쓰지 않도록 현재 적용본을 읽어 지정한 key만 바꾼다.
 */
export async function saveFields(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  input: FieldsSaveInput,
): Promise<ContentEditorView> {
  requireRole(admin);
  if (!PAGES.includes(input.page)) throw new DomainError('BAD_REQUEST', '알 수 없는 화면입니다.');
  if (input.fields.length === 0) throw new DomainError('BAD_REQUEST', '저장할 항목이 없습니다.');
  const campaign = await loadCampaign(env, campaignSlug);
  const applied = await loadAppliedBody(env, campaign.id, input.page);

  if (applied.version !== input.expectedVersion) {
    throw new DomainError('CONFLICT', '다른 곳에서 먼저 저장되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.');
  }

  const patches = new Map(input.fields.map((field) => [field.key, field]));
  const retentionPatch = input.page === 'SUBMISSION' ? patches.get(PII_RETENTION_FIELD) : undefined;
  if (retentionPatch) parseRetentionDays(retentionPatch.text ?? '');
  const blocks: ContentBlock[] = applied.body.blocks.map((block) => {
    const patch = patches.get(block.key);
    if (patch === undefined) return block;
    if (patch.items !== undefined) {
      return { key: block.key, type: block.type, items: patch.items.filter((line) => line.trim().length > 0) };
    }
    return { key: block.key, type: block.type, text: patch.text ?? '' };
  });
  if (retentionPatch && !blocks.some((b) => b.key === PII_RETENTION_FIELD)) {
    blocks.push({ key: PII_RETENTION_FIELD, type: 'helper', text: String(parseRetentionDays(retentionPatch.text ?? '')) });
  }
  for (const key of patches.keys()) {
    if (!(input.page === 'SUBMISSION' && Object.hasOwn(POLICY_FIELDS, key)) && !blocks.some((block) => block.key === key)) {
      throw new DomainError('BAD_REQUEST', '알 수 없는 항목입니다.');
    }
  }

  const body: ContentBody = { blocks, ...(applied.body.internalNotes === undefined ? {} : { internalNotes: applied.body.internalNotes }) };
  const problems = validateBody(input.page, body);
  if (problems.length > 0) throw new DomainError('UNPROCESSABLE', problems.join(' / '));

  const now = Date.now();
  const version = applied.version + 1;
  const id = newId();
  const digest = await digestOf(body);
  const changedKeys = [...patches.keys()];
  const legalChange = changedKeys.some((key) => LEGAL_BLOCK_KEYS.includes(key) || Object.hasOwn(POLICY_FIELDS, key));
  const guardId = newId();
  const policyStatements: D1PreparedStatement[] = [];
  if (input.page === 'SUBMISSION') {
    for (const [key, kind] of Object.entries(POLICY_FIELDS)) {
      const patch = patches.get(key);
      if (!patch) continue;
      const policyBody = patch.text?.trim() ?? '';
      if (patch.items !== undefined || policyBody.length < 20 || policyBody.length > 20000) {
        throw new DomainError('UNPROCESSABLE', '동의문 본문은 20자 이상 20,000자 이하로 입력해주세요.');
      }
      const current = await env.DB.prepare(
        `SELECT cp.policy_id, d.body FROM campaign_policies cp JOIN policy_documents d ON d.id=cp.policy_id WHERE cp.campaign_id=? AND cp.kind=?`,
      ).bind(campaign.id, kind).first<{ policy_id: string; body: string }>();
      if (current?.body === policyBody) continue;
      const policyId = newId();
      const policyGuard = newId();
      policyStatements.push(
        env.DB.prepare(`INSERT INTO operation_guards(id,ok) VALUES (?,CASE WHEN COALESCE((SELECT policy_id FROM campaign_policies WHERE campaign_id=? AND kind=?),'')=? THEN 1 ELSE 0 END)`)
          .bind(policyGuard, campaign.id, kind, current?.policy_id ?? ''),
        env.DB.prepare(`INSERT INTO policy_documents(id,campaign_id,kind,version,body,digest,effective_at,created_at) VALUES (?,?,?,(SELECT COALESCE(MAX(version),0)+1 FROM policy_documents WHERE campaign_id=? AND kind=?),?,?,?,?)`)
          .bind(policyId, campaign.id, kind, campaign.id, kind, policyBody, await digestOf(policyBody), now, now),
        env.DB.prepare(`INSERT INTO campaign_policies(campaign_id,kind,policy_id,required) VALUES (?,?,?,1) ON CONFLICT(campaign_id,kind) DO UPDATE SET policy_id=excluded.policy_id,required=1`)
          .bind(campaign.id, kind, policyId),
        ...auditStatements(env, { actorId: admin.id, action: 'POLICY_BODY_SAVED', targetType: 'policy_document', targetId: policyId, outcome: 'SUCCESS', requestId: input.requestId, metadata: { kind, previousPolicyId: current?.policy_id ?? null } }, now),
        env.DB.prepare(`DELETE FROM operation_guards WHERE id=?`).bind(policyGuard),
      );
    }
  }

  try {
    await env.DB.batch([
      ...policyStatements,
      // 저장 직전에 적용 버전이 그대로인지 다시 확인한다.
      env.DB.prepare(
        `INSERT INTO operation_guards(id, ok) VALUES (?, CASE WHEN
           COALESCE((SELECT v.version FROM content_publications p JOIN content_versions v ON v.id = p.content_version_id
                      WHERE p.campaign_id = ? AND p.page = ? AND p.locale = 'ko'), 0) = ?
         THEN 1 ELSE 0 END)`,
      ).bind(guardId, campaign.id, input.page, input.expectedVersion),
      env.DB.prepare(
        `INSERT INTO content_versions(id, campaign_id, page, locale, version, body_json, digest, status, legal_change, policy_refs_json, maker_id, row_version, created_at, updated_at)
         VALUES (?, ?, ?, 'ko', ?, ?, ?, 'PUBLISHED', ?, '{}', ?, 1, ?, ?)`,
      ).bind(id, campaign.id, input.page, version, JSON.stringify(body), digest, legalChange ? 1 : 0, admin.id, now, now),
      env.DB.prepare(
        `UPDATE content_versions SET status = 'SUPERSEDED', updated_at = ?
          WHERE campaign_id = ? AND page = ? AND locale = 'ko' AND status = 'PUBLISHED' AND id <> ?`,
      ).bind(now, campaign.id, input.page, id),
      env.DB.prepare(
        `INSERT INTO content_publications(campaign_id, page, locale, content_version_id, revision, published_by, published_at)
         VALUES (?, ?, 'ko', ?, ?, ?, ?)
         ON CONFLICT(campaign_id, page, locale)
         DO UPDATE SET content_version_id = excluded.content_version_id, revision = excluded.revision,
                       published_by = excluded.published_by, published_at = excluded.published_at`,
      ).bind(campaign.id, input.page, id, version, admin.id, now),
      ...auditStatements(
        env,
        {
          actorId: admin.id,
          action: 'CONTENT_FIELD_SAVED',
          targetType: 'content_version',
          targetId: id,
          outcome: 'SUCCESS',
          requestId: input.requestId,
          metadata: { page: input.page, fields: changedKeys, legalChange },
        },
        now,
      ),
      env.DB.prepare(`DELETE FROM operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('ok=1') || text.includes('operation_guards')) {
      throw new DomainError('CONFLICT', '다른 곳에서 먼저 저장되었습니다. 최신 내용을 확인해주세요.');
    }
    throw error;
  }

  return getEditor(env, admin, campaignSlug, input.page);
}

/** 저장 전 미리보기. 실제 화면과 같은 변환을 거친다. */
export async function previewFields(
  env: DataEnv,
  admin: AdminIdentity,
  campaignSlug: string,
  page: ContentPage,
  fields: readonly { key: string; text?: string; items?: readonly string[] }[],
): Promise<ReturnType<typeof toPublicContent>> {
  requireRole(admin);
  const campaign = await loadCampaign(env, campaignSlug);
  const applied = await loadAppliedBody(env, campaign.id, page);
  const overrides = new Map(fields.map((f) => [f.key, f]));
  const blocks: ContentBlock[] = applied.body.blocks.map((block) => {
    const patch = overrides.get(block.key);
    if (patch === undefined) return block;
    if (patch.items !== undefined) return { key: block.key, type: block.type, items: [...patch.items] };
    return { key: block.key, type: block.type, text: patch.text ?? '' };
  });
  return toPublicContent(applied.versionId ?? 'preview', page, { blocks }, {
    maxMessageLength: campaign.max_message_length,
  });
}
