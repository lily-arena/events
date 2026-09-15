import { DomainError } from '@first-seat/domain';
import { digestOf } from '@first-seat/security';
import type { DataEnv } from '../env.js';
import { loadCampaign } from '../campaign.js';
import { auditStatements, requireRole, type AdminIdentity } from './common.js';

export async function resetTestData(
  env: DataEnv, admin: AdminIdentity, slug: string, expectedRevision: number,
  resetId: string, confirmation: string, requestId: string,
): Promise<{ revision: number }> {
  requireRole(admin);
  if (confirmation !== 'DELETE_TEST_DATA_AND_REOPEN' || !/^[0-9a-f-]{36}$/i.test(resetId)) {
    throw new DomainError('BAD_REQUEST', '삭제 범위를 확인한 뒤 다시 실행해주세요.');
  }
  const campaign = await loadCampaign(env, slug);
  const previous = await env.DB.prepare(
    'SELECT campaign_id, actor_id, resulting_revision FROM campaign_reset_runs WHERE id=? AND status=\'DONE\'',
  ).bind(resetId).first<{campaign_id:string; actor_id:string; resulting_revision:number}>();
  if (previous) {
    if (previous.campaign_id !== campaign.id || previous.actor_id !== admin.id) throw new DomainError('CONFLICT','다른 초기화 요청입니다.');
    return {revision:previous.resulting_revision};
  }
  if (campaign.revision !== expectedRevision) throw new DomainError('CONFLICT','캠페인이 변경되었습니다. 새로고침 후 다시 확인해주세요.');
  const now = Date.now(), revision = expectedRevision + 1;
  const id = campaign.id;
  const sql = (query:string) => env.DB.prepare(query).bind(id);
  const statements = [
    env.DB.prepare('INSERT INTO operation_guards(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=? AND revision=?) THEN 1 ELSE 0 END)').bind(resetId,id,expectedRevision),
    env.DB.prepare("INSERT INTO campaign_reset_runs VALUES(?,?,?,?,?,?,'RUNNING')").bind(resetId,id,admin.id,expectedRevision,revision,now),
    sql('DELETE FROM reveal_grants WHERE submission_id IN (SELECT id FROM submissions WHERE campaign_id=?)'),
    sql('DELETE FROM result_media WHERE result_id IN (SELECT id FROM result_versions WHERE campaign_id=?)'),
    sql('DELETE FROM result_versions WHERE campaign_id=?'),
    sql('DELETE FROM jury_scores WHERE set_id IN (SELECT id FROM candidate_sets WHERE campaign_id=?)'),
    sql("DELETE FROM idempotency_records WHERE resource_id IN (SELECT id FROM votes WHERE campaign_id=?)"),
    sql("DELETE FROM idempotency_records WHERE resource_id IN (SELECT id FROM submissions WHERE campaign_id=?)"),
    sql('DELETE FROM vote_decisions WHERE vote_id IN (SELECT id FROM votes WHERE campaign_id=?)'),
    sql('DELETE FROM vote_risk_signals WHERE vote_id IN (SELECT id FROM votes WHERE campaign_id=?)'),
    sql('DELETE FROM votes WHERE campaign_id=?'),
    sql('DELETE FROM candidates WHERE campaign_id=?'),
    sql('DELETE FROM candidate_sets WHERE campaign_id=?'),
    sql('DELETE FROM pii_contacts WHERE submission_id IN (SELECT id FROM submissions WHERE campaign_id=?)'),
    sql('DELETE FROM consent_receipts WHERE submission_id IN (SELECT id FROM submissions WHERE campaign_id=?)'),
    sql('DELETE FROM submissions WHERE campaign_id=?'),
    sql('DELETE FROM session_policy_receipts WHERE session_id IN (SELECT id FROM anonymous_sessions WHERE campaign_id=?)'),
    sql('DELETE FROM anonymous_sessions WHERE campaign_id=?'),
    // Rate keys are campaign/epoch scoped. Old rate counters expire normally.
    env.DB.prepare("UPDATE campaigns SET state='SUBMISSION_OPEN',revision=?,paused=0,launch_approved=1,submission_start=?,submission_end=NULL,voting_start=NULL,voting_end=NULL,voting_epoch=MAX(voting_epoch,1)+1,updated_at=? WHERE id=?")
      .bind(revision,Math.floor(now/1000)*1000,now,id),
    env.DB.prepare('INSERT INTO campaign_revisions(campaign_id,revision,config_json,digest,actor_id,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,revision,JSON.stringify({state:'SUBMISSION_OPEN',action:'RESET_TEST_DATA'}),await digestOf({resetId,revision}),admin.id,now),
    ...auditStatements(env,{actorId:admin.id,action:'TEST_DATA_RESET',targetType:'campaign',targetId:id,outcome:'SUCCESS',requestId,metadata:{resetId,previousState:campaign.state,revision}},now),
    env.DB.prepare("UPDATE campaign_reset_runs SET status='DONE' WHERE id=?").bind(resetId),
    env.DB.prepare('DELETE FROM operation_guards WHERE id=?').bind(resetId),
  ];
  try { await env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes('operation_guards') || String(error).includes('UNIQUE')) throw new DomainError('CONFLICT','다른 작업이 먼저 처리되었습니다. 새로고침해주세요.');
    throw error;
  }
  return {revision};
}
