import {encodePolicy} from '../../../../packages/event-builder/src/consents';
import { sha256Hex } from '../../../../packages/security/src/hash';
import { stagesFor, type EventDraft, type Stage } from '../../../../packages/event-builder/src/model';
import { validateDraft, assertPublishable } from '../../../../packages/event-builder/src/validation';

export interface EventRow {
 id: string; slug: string; title: string; visibility: 'draft'|'published'|'archived';
 draft_json: string; published_json: string|null; revision: number; current_stage_id: string|null;
 created_at: number; updated_at: number; activity_revision: number;
}
/** Only authenticated AdminData RPC methods may construct this repository. */
export class EventsRepository {
 constructor(private db: D1Database, private actor: string, private activeVerified=false) {}
 private statement(sql: string, ...args: unknown[]) { return this.db.prepare(sql).bind(...args); }
 private audit(eventId: string, action: string, metadata = {}) {
  return this.statement('INSERT INTO event_audit(id,event_id,admin_id,action,metadata_json,created_at) VALUES(?,?,?,?,?,?)', crypto.randomUUID(),eventId,this.actor,action,JSON.stringify(metadata),Date.now());
 }
 async requireActive() {
  if(this.activeVerified)return;
  if (!await this.statement('SELECT id FROM platform_admins WHERE id=? AND active=1',this.actor).first()) throw new Error('로그인이 필요합니다.');
  this.activeVerified=true;
 }
 async list() {
  await this.requireActive();
  return (await this.statement('SELECT id,slug,title,visibility,revision,current_stage_id,updated_at,draft_json FROM events ORDER BY updated_at DESC LIMIT 200').all()).results;
 }
 async get(id: string): Promise<EventRow> {
  await this.requireActive();
  const row = await this.statement('SELECT e.*,(SELECT accepting FROM event_stages WHERE event_id=e.id AND id=e.current_stage_id) AS accepting FROM events e WHERE e.id=?',id).first<EventRow>();
  if (!row) throw new Error('이벤트를 찾을 수 없습니다.');
  return row;
 }
 async create(input: unknown, sourceId?:string) {
  await this.requireActive();
  const id = crypto.randomUUID(), draft = validateDraft(input,id), now = Date.now();
  const stages = stagesFor(draft);
  await this.db.batch([
   this.statement('INSERT INTO events(id,slug,title,draft_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,draft.slug,draft.title,JSON.stringify(draft),now,now),
   ...stages.map((kind,position)=>this.statement('INSERT INTO event_stages(event_id,id,kind,title,position,max_length,allow_repeat) VALUES(?,?,?,?,?,?,?)',id,kind,kind,kind,position,draft.maxLength,Number(draft.allowRepeatVotes))),
   this.statement('UPDATE events SET current_stage_id=? WHERE id=?',stages[0],id),
   ...(sourceId ? [
    this.statement('INSERT INTO event_assets SELECT ?,id,content_base64,byte_length,mime,created_at FROM event_assets WHERE event_id=?',id,sourceId),
    this.statement('INSERT INTO event_policies SELECT ?,id,kind,version,body,digest,created_at FROM event_policies WHERE event_id=?',id,sourceId),
    this.statement('INSERT INTO stage_policies SELECT ?,stage_id,kind,policy_id,required FROM stage_policies WHERE event_id=?',id,sourceId)
   ] : []),
   this.audit(id,sourceId?'event.duplicated':'event.created')
  ]);
  return this.get(id);
 }
 async duplicate(sourceId: string, title: string, slug: string) {
  const source = await this.get(sourceId);
  return this.create({...JSON.parse(source.draft_json),title,slug},sourceId);
 }
 async save(id: string, expectedRevision: number, input: unknown) {
  const existing = await this.get(id), draft = validateDraft(input,id);
  // Public URLs remain stable once published. Page copy can change independently.
  if (existing.published_json && draft.slug !== existing.slug) throw new Error('공개한 이벤트의 주소는 변경할 수 없습니다.');
  const previous = JSON.parse(existing.draft_json) as EventDraft;
  if (draft.template !== previous.template) throw new Error('템플릿을 바꾸려면 새 이벤트를 생성해주세요.');
  const stages=stagesFor(draft);
  const previousStages=stagesFor(previous);
  if(existing.published_json && JSON.stringify(stages)!==JSON.stringify(previousStages))throw new Error('공개 후에는 단계 구성을 변경할 수 없습니다. 이벤트를 복제해주세요.');
  const guard = crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE events SET slug=?,title=?,draft_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',draft.slug,draft.title,JSON.stringify(draft),Date.now(),id,expectedRevision),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),

   ...(!existing.published_json ? [
    this.statement('UPDATE events SET current_stage_id=NULL WHERE id=?',id),
    this.statement('UPDATE event_stages SET position=position+100 WHERE event_id=?',id),
    ...stages.map((kind,position)=>this.statement('INSERT INTO event_stages(event_id,id,kind,title,position,max_length,allow_repeat) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id,id) DO UPDATE SET position=excluded.position',id,kind,kind,kind,position,draft.maxLength,Number(draft.allowRepeatVotes))),
    this.statement(`DELETE FROM stage_policies WHERE event_id=? AND stage_id NOT IN (${stages.map(()=>'?').join(',')})`,id,...stages),
    this.statement(`DELETE FROM event_stages WHERE event_id=? AND id NOT IN (${stages.map(()=>'?').join(',')})`,id,...stages),
    this.statement('UPDATE events SET current_stage_id=? WHERE id=?',stages[0],id)
   ] : []),
   this.audit(id,'event.draft_saved',{revision:expectedRevision+1}),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }
 async archive(id: string, revision: number) {
  await this.get(id);
  const guard = crypto.randomUUID();
  await this.db.batch([
   this.statement("UPDATE events SET visibility='archived',revision=revision+1,updated_at=? WHERE id=? AND revision=?",Date.now(),id,revision),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_stages SET accepting=0 WHERE event_id=?',id),
   this.audit(id,'event.archived'),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 } async revealEnvelope(id:string,participantId:string) {
  await this.get(id);
  const row=await this.statement('SELECT envelope_json,key_version FROM event_participants WHERE event_id=? AND id=? AND retention_until>?',id,participantId,Date.now()).first<{envelope_json:string;key_version:string}>();
  if(!row)throw new Error('조회 가능한 개인정보가 없습니다.');
  await this.audit(id,'privacy.reveal_requested',{participantId}).run();
  return row;
 }
 async revealOutcome(id:string,participantId:string,success:boolean) {
  await this.get(id);await this.audit(id,success?'privacy.revealed':'privacy.reveal_failed',{participantId}).run();
 }
 async participants(id:string) {await this.get(id);return (await this.statement('SELECT id,entry_id,vote_id,masked_json,retention_until FROM event_participants WHERE event_id=? ORDER BY retention_until DESC LIMIT 200',id).all()).results;}
 async participantPage(id:string,page:number){
  await this.get(id);if(!Number.isSafeInteger(page)||page<1)throw new Error('페이지를 확인해주세요.');
  const count=await this.statement('SELECT count(*) AS total FROM event_participants WHERE event_id=?',id).first<{total:number}>(),total=count?.total??0,pageSize=50,current=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const entries=(await this.statement("SELECT p.id,p.masked_json,p.entry_id,p.vote_id,coalesce(e.message,c.message,'') AS message,coalesce(e.created_at,v.created_at) AS created_at,coalesce(e.status,'vote') AS status FROM event_participants p LEFT JOIN event_entries e ON e.event_id=p.event_id AND e.id=p.entry_id LEFT JOIN event_votes v ON v.event_id=p.event_id AND v.id=p.vote_id LEFT JOIN event_candidates c ON c.event_id=v.event_id AND c.stage_id=v.stage_id AND c.round=v.round AND c.id=v.candidate_id WHERE p.event_id=? ORDER BY coalesce(e.created_at,v.created_at) DESC,p.id LIMIT ? OFFSET ?",id,pageSize,(current-1)*pageSize).all()).results;
  return {entries,total,page:current,pageSize};
 }
 async auditLog(id:string) {await this.get(id);return (await this.statement('SELECT action,target_id,metadata_json,created_at FROM event_audit WHERE event_id=? ORDER BY created_at DESC LIMIT 200',id).all()).results;}
 async deletePrivate(id:string,participantId:string) {
  await this.get(id); const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('INSERT INTO event_operation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM event_participants WHERE event_id=? AND id=?) THEN 1 ELSE 0 END',guard,id,participantId),
   this.statement('DELETE FROM event_consents WHERE event_id=? AND participant_id=?',id,participantId),
   this.statement('DELETE FROM event_identity_claims WHERE event_id=? AND vote_id=(SELECT vote_id FROM event_participants WHERE event_id=? AND id=?)',id,id,participantId),
   this.statement('DELETE FROM event_vote_identities WHERE event_id=? AND vote_id=(SELECT vote_id FROM event_participants WHERE event_id=? AND id=?)',id,id,participantId),
   this.statement('DELETE FROM event_participants WHERE event_id=? AND id=?',id,participantId),
   this.statement('INSERT OR IGNORE INTO event_identity_claims SELECT event_id,stage_id,round,field,identity_hmac,min(vote_id) FROM event_vote_identities WHERE event_id=? GROUP BY event_id,stage_id,round,field,identity_hmac',id),
   this.audit(id,'privacy.deleted',{participantId,duplicateProtectionRemoved:true}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
 }
 async uploadAsset(id:string,content:string) {
  await this.get(id);
  if(typeof content!=='string'||content.length>262144)throw new Error('이미지가 너무 큽니다.');
  const bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0));
  if(bytes.length<30||bytes.length>196608||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WEBP')throw new Error('WebP 이미지 파일을 확인해주세요.');
  const assetId=crypto.randomUUID(),guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('INSERT INTO event_operation_guards SELECT ?,CASE WHEN (SELECT count(*) FROM event_assets WHERE event_id=?)<40 THEN 1 ELSE 0 END',guard,id),
   this.statement('INSERT INTO event_assets VALUES(?,?,?,?,?,?)',id,assetId,content,bytes.length,'image/webp',Date.now()),
   this.audit(id,'image.uploaded',{assetId,bytes:bytes.length}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);return {id:assetId};
 }
 async asset(id:string,assetId:string) {await this.get(id);return this.statement('SELECT content_base64,mime FROM event_assets WHERE event_id=? AND id=?',id,assetId).first<{content_base64:string;mime:string}>();}
 async entries(id: string) {
  await this.get(id);
  return (await this.statement('SELECT e.*,p.id AS participant_id,p.masked_json FROM event_entries e LEFT JOIN event_participants p ON p.event_id=e.event_id AND p.entry_id=e.id WHERE e.event_id=? ORDER BY e.created_at DESC LIMIT 200',id).all()).results;
 }
 async reviewEntries(id:string,status:string,query:string,page:number) {
  await this.get(id);
  if(!['all','pending','approved','rejected','candidate'].includes(status)||typeof query!=='string'||query.length>200||!Number.isSafeInteger(page)||page<1)throw new Error('검색 조건을 확인해주세요.');
  const where="event_id=? AND (?='all' OR status=?) AND instr(lower(message),lower(?))>0";
  const total=await this.statement('SELECT count(*) AS total FROM event_entries WHERE '+where,id,status,status,query.trim()).first<{total:number}>();
  const count=total?.total??0,pageSize=50,current=Math.min(page,Math.max(1,Math.ceil(count/pageSize)));
  const entries=(await this.statement('SELECT id,message,created_at,status,revision,EXISTS(SELECT 1 FROM event_candidates c WHERE c.event_id=event_entries.event_id AND c.entry_id=event_entries.id AND c.confirmed=1) AS locked FROM event_entries WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',id,status,status,query.trim(),pageSize,(current-1)*pageSize).all()).results;
  return {entries,total:count,page:current,pageSize};
 }
 async policies(id: string) {
  await this.get(id);
  return (await this.statement('SELECT s.stage_id,s.kind,s.required,p.id,p.version,p.body FROM stage_policies s JOIN event_policies p ON p.event_id=s.event_id AND p.id=s.policy_id WHERE s.event_id=?',id).all()).results;
 }
 async savePolicy(id:string,stageId:string,kind:string,body:string,revision:number) {
  await this.get(id);
  if(!['privacy','work-license'].includes(kind) || typeof body!=='string' || !body.trim() || body.length>20000) throw new Error('동의문을 확인해주세요.');
  const policyId=crypto.randomUUID(), guard=crypto.randomUUID(), digest=await sha256Hex(body);
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1,updated_at=? WHERE id=? AND revision=?',Date.now(),id,revision),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('INSERT INTO event_policies(event_id,id,kind,version,body,digest,created_at) SELECT ?,?,?,coalesce(max(version),0)+1,?,?,? FROM event_policies WHERE event_id=? AND kind=?',id,policyId,kind,body,digest,Date.now(),id,kind),
   this.statement('INSERT INTO stage_policies VALUES(?,?,?,?,1) ON CONFLICT(event_id,stage_id,kind) DO UPDATE SET policy_id=excluded.policy_id',id,stageId,kind,policyId),
   this.audit(id,'policy.version_created',{stageId,kind,policyId}),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }
 async publish(id:string,revision:number) {
  const event=await this.get(id),draft=validateDraft(JSON.parse(event.draft_json),id);
  const current=await this.statement('SELECT kind FROM event_stages WHERE event_id=? AND id=?',id,event.current_stage_id).first<{kind:Stage}>();
  if(!current) throw new Error('현재 단계를 확인해주세요.');
  assertPublishable(draft,current.kind);
  if(current.kind==='voting'){const candidates=await this.candidates(id,event.current_stage_id!);if(!candidates.length||candidates.some(c=>!c.confirmed))throw new Error('후보를 먼저 확정해주세요.');}
  if(current.kind==='result'&&!await this.statement('SELECT 1 FROM event_results WHERE event_id=? AND stage_id=?',id,event.current_stage_id).first())throw new Error('결과 문구를 먼저 선택해주세요.');
  const configured=draft.pages[current.kind].find(m=>m.type==='consent')?.consents;
  if(configured&&configured.some(item=>!item.body.trim()))throw new Error('동의문 원문을 모두 입력해주세요.');
  if(current.kind!=='result') {
   const policies=configured?configured.map(item=>({stage_id:event.current_stage_id,kind:item.id})):await this.policies(id);
   if(!policies.some(p=>p.stage_id===event.current_stage_id && p.kind==='privacy')) throw new Error('개인정보 동의문을 저장해주세요.');
   if(current.kind==='submission' && !policies.some(p=>p.stage_id===event.current_stage_id && p.kind==='work-license')) throw new Error('응모작 활용 동의문을 저장해주세요.');
  }
  const policyWrites:D1PreparedStatement[]=[];
  for(const stage of stagesFor(draft)){
   const items=draft.pages[stage].find(m=>m.type==='consent')?.consents;
   if(!items||items.some(item=>!item.body.trim()))continue;
   for(const item of items){
    const body=encodePolicy(item);
    const old=await this.statement('SELECT p.body FROM stage_policies s JOIN event_policies p ON p.event_id=s.event_id AND p.id=s.policy_id WHERE s.event_id=? AND s.stage_id=? AND s.kind=?',id,stage,item.id).first<{body:string}>();
    if(old?.body===body)continue;
    const policyId=crypto.randomUUID(),digest=await sha256Hex(body);
    policyWrites.push(this.statement('INSERT INTO event_policies(event_id,id,kind,version,body,digest,created_at) SELECT ?,?,?,coalesce(max(version),0)+1,?,?,? FROM event_policies WHERE event_id=? AND kind=?',id,policyId,item.id,body,digest,Date.now(),id,item.id),this.statement('INSERT INTO stage_policies VALUES(?,?,?,?,1) ON CONFLICT(event_id,stage_id,kind) DO UPDATE SET policy_id=excluded.policy_id',id,stage,item.id,policyId),this.audit(id,'policy.version_created',{stageId:stage,kind:item.id,policyId}));
   }
   if(items.length)policyWrites.push(this.statement(`DELETE FROM stage_policies WHERE event_id=? AND stage_id=? AND kind NOT IN (${items.map(()=>'?').join(',')})`,id,stage,...items.map(item=>item.id)));
  }
  const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement("UPDATE events SET published_json=draft_json,visibility='published',revision=revision+1,updated_at=? WHERE id=? AND revision=?",Date.now(),id,revision),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   ...policyWrites,
   // Build claim union atomically before prohibiting repeat votes. Existing votes remain intact.
   this.statement('INSERT OR IGNORE INTO event_identity_claims(event_id,stage_id,round,field,identity_hmac,vote_id) SELECT event_id,stage_id,round,field,identity_hmac,min(vote_id) FROM event_vote_identities WHERE event_id=? GROUP BY event_id,stage_id,round,field,identity_hmac',id),
   this.statement('UPDATE event_stages SET max_length=?,allow_repeat=? WHERE event_id=?',draft.maxLength,Number(draft.allowRepeatVotes),id),
   this.audit(id,'event.published',{revision}),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }
 async schedule(id:string,stageId:string,startsAt:number|null,endsAt:number|null,revision:number) {
  await this.get(id);
  for(const time of [startsAt,endsAt])if(time!==null&&(!Number.isSafeInteger(time)||time<0))throw new Error('일정을 확인해주세요.');
  if(startsAt!==null&&endsAt!==null&&endsAt<=startsAt)throw new Error('종료 시각은 시작 시각 이후로 설정해주세요.');
  const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1 WHERE id=? AND revision=?',id,revision),this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_stages SET starts_at=?,ends_at=? WHERE event_id=? AND id=?',startsAt,endsAt,id,stageId),this.statement('UPDATE event_operation_guards SET ok=changes() WHERE id=?',guard),
   this.audit(id,'stage.schedule_changed',{stageId,startsAt,endsAt}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);return this.get(id);
 }
 async candidates(id:string,stageId:string) {
  await this.get(id);
  return (await this.statement('SELECT c.*,count(v.id) AS votes FROM event_candidates c JOIN event_stages s ON s.event_id=c.event_id AND s.id=c.stage_id AND s.round=c.round LEFT JOIN event_votes v ON v.event_id=c.event_id AND v.stage_id=c.stage_id AND v.round=c.round AND v.candidate_id=c.id WHERE c.event_id=? AND c.stage_id=? GROUP BY c.event_id,c.stage_id,c.round,c.id ORDER BY votes DESC,c.position',id,stageId).all()).results;
 }
 async review(id:string,entryId:string,status:string,revision:number) {
  await this.get(id);
  if(!['pending','approved','rejected','candidate'].includes(status)) throw new Error('심사 상태를 확인해주세요.');
  const entry=await this.statement('SELECT message FROM event_entries WHERE event_id=? AND id=?',id,entryId).first<{message:string}>();
  if(!entry) throw new Error('응모작을 찾을 수 없습니다.');
  const voting=await this.statement("SELECT id,round FROM event_stages WHERE event_id=? AND kind='voting' ORDER BY position LIMIT 1",id).first<{id:string;round:number}>();
  if(status==='candidate' && !voting) throw new Error('투표 단계를 추가해주세요.');
  if(status==='candidate' && voting && await this.statement('SELECT 1 FROM event_candidates WHERE event_id=? AND stage_id=? AND round=? AND confirmed=1',id,voting.id,voting.round).first())throw new Error('확정한 후보는 변경할 수 없습니다.');
  const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE event_entries SET status=?,revision=revision+1 WHERE event_id=? AND id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM event_candidates WHERE event_id=? AND entry_id=? AND confirmed=1) AND (?<>\'candidate\' OR NOT EXISTS(SELECT 1 FROM event_candidates c JOIN event_stages s ON s.event_id=c.event_id AND s.id=c.stage_id AND s.round=c.round WHERE c.event_id=? AND c.confirmed=1))',status,id,entryId,revision,id,entryId,status,id),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('DELETE FROM event_candidates WHERE event_id=? AND entry_id=? AND confirmed=0',id,entryId),
   ...(status==='candidate' && voting ? [this.statement('INSERT INTO event_candidates(event_id,stage_id,round,id,entry_id,message,position) SELECT ?,?,?,?,?,?,coalesce(max(position),-1)+1 FROM event_candidates WHERE event_id=? AND stage_id=? AND round=?',id,voting.id,voting.round,crypto.randomUUID(),entryId,entry.message,id,voting.id,voting.round)] : []),
   this.audit(id,'entry.reviewed',{entryId,status}),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.statement('SELECT id,message,created_at,status,revision,0 AS locked FROM event_entries WHERE event_id=? AND id=?',id,entryId).first();
 }
 async reorderCandidates(id:string,stageId:string,ids:string[],activity:number){
  const event=await this.get(id),items=await this.candidates(id,stageId);
  if(!Array.isArray(ids)||ids.length!==items.length||new Set(ids).size!==ids.length||items.some(c=>!ids.includes(c.id as string)||c.confirmed))throw new Error('확정 전 후보 전체의 순서를 확인해주세요.');
  if(!ids.length)throw new Error('후보가 없습니다.');
  const guard=crypto.randomUUID(),offset=Math.max(...items.map(c=>Number(c.position)))+ids.length+1;
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1 WHERE id=? AND revision=? AND activity_revision=?',id,event.revision,activity),this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_candidates SET position=position+? WHERE event_id=? AND stage_id=? AND round=(SELECT round FROM event_stages WHERE event_id=? AND id=?) AND confirmed=0',offset,id,stageId,id,stageId),
   ...ids.map((candidate,index)=>this.statement('UPDATE event_candidates SET position=? WHERE event_id=? AND stage_id=? AND id=? AND round=(SELECT round FROM event_stages WHERE event_id=? AND id=?) AND confirmed=0',index,id,stageId,candidate,id,stageId)),
   this.audit(id,'candidates.reordered',{stageId}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);return this.get(id);
 }
 async confirmCandidates(id:string,stageId:string,activity:number) {
  const event=await this.get(id);
  const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1 WHERE id=? AND revision=? AND activity_revision=? AND EXISTS(SELECT 1 FROM event_candidates c JOIN event_stages s ON s.event_id=c.event_id AND s.id=c.stage_id AND s.round=c.round WHERE c.event_id=? AND c.stage_id=?)',id,event.revision,activity,id,stageId),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_candidates SET confirmed=1 WHERE event_id=? AND stage_id=? AND round=(SELECT round FROM event_stages WHERE event_id=? AND id=?)',id,stageId,id,stageId),
   this.audit(id,'candidates.confirmed',{stageId}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }
 async selectResult(id:string,stageId:string,votingStageId:string,candidateId:string,revision:number) {
  await this.get(id); const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1 WHERE id=? AND revision=?',id,revision),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement("INSERT INTO event_results(event_id,stage_id,voting_stage_id,round,candidate_id,created_at) SELECT ?,?,?,c.round,c.id,? FROM event_candidates c JOIN event_stages s ON s.event_id=c.event_id AND s.id=c.stage_id AND s.round=c.round WHERE c.event_id=? AND c.stage_id=? AND c.id=? AND c.confirmed=1 AND EXISTS(SELECT 1 FROM event_stages WHERE event_id=? AND id=? AND kind='result') ON CONFLICT(event_id,stage_id) DO UPDATE SET voting_stage_id=excluded.voting_stage_id,round=excluded.round,candidate_id=excluded.candidate_id,created_at=excluded.created_at",id,stageId,votingStageId,Date.now(),id,votingStageId,candidateId,id,stageId),
   this.statement('UPDATE event_operation_guards SET ok=changes() WHERE id=?',guard),
   this.audit(id,'result.selected',{stageId,candidateId}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }
 async transitionPreview(id:string,stageId:string) {
  const event=await this.get(id);
  const stage=await this.statement('SELECT * FROM event_stages WHERE event_id=? AND id=?',id,stageId).first<{kind:Stage}>();
  if(!stage) throw new Error('단계를 찾을 수 없습니다.');
  const candidates=stage.kind==='voting'?await this.candidates(id,stageId):[];
  const result=stage.kind==='result'?await this.statement('SELECT c.message,c.id FROM event_results r JOIN event_candidates c ON c.event_id=r.event_id AND c.stage_id=r.voting_stage_id AND c.round=r.round AND c.id=r.candidate_id WHERE r.event_id=? AND r.stage_id=?',id,stageId).first():null;
  const blockers:string[]=[];
  if(!event.published_json||event.visibility!=='published')blockers.push('페이지를 먼저 공개해주세요.');
  if(event.published_json){try{assertPublishable(JSON.parse(event.published_json),stage.kind);}catch(error){blockers.push(error instanceof Error?error.message:'페이지 구성을 확인해주세요.');}}
  if(stage.kind==='voting'&&(!candidates.length||candidates.some(c=>!c.confirmed)))blockers.push('후보를 먼저 확정해주세요.');
  if(stage.kind==='result'&&!result)blockers.push('결과 문구를 먼저 선택해주세요.');
  const policies=await this.policies(id);
  if(stage.kind!=='result'&&!policies.some(p=>p.stage_id===stageId&&p.kind==='privacy'))blockers.push('개인정보 동의문을 저장해주세요.');
  if(stage.kind==='submission'&&!policies.some(p=>p.stage_id===stageId&&p.kind==='work-license'))blockers.push('응모작 활용 동의문을 저장해주세요.');
  const checks=[{id:'published',label:'페이지 공개',complete:!!event.published_json&&event.visibility==='published'},
   {id:'page',label:'페이지 구성·푸터 설정',complete:!!event.published_json&&!blockers.some(b=>!['페이지를 먼저 공개해주세요.','후보를 먼저 확정해주세요.','결과 문구를 먼저 선택해주세요.','개인정보 동의문을 저장해주세요.','응모작 활용 동의문을 저장해주세요.'].includes(b))}];
  if(stage.kind!=='result')checks.push({id:'privacy',label:'개인정보 동의문',complete:policies.some(p=>p.stage_id===stageId&&p.kind==='privacy')});
  if(stage.kind==='submission')checks.push({id:'license',label:'응모작 활용 동의문',complete:policies.some(p=>p.stage_id===stageId&&p.kind==='work-license')});
  if(stage.kind==='voting')checks.push({id:'candidates',label:'투표 후보 확정',complete:candidates.length>0&&candidates.every(c=>!!c.confirmed)});
  if(stage.kind==='result')checks.push({id:'result',label:'최종 문구 선정',complete:!!result});
  return {revision:event.revision,activityRevision:event.activity_revision,stage,candidates,result,checks,blockers,canTransition:blockers.length===0};
 }
 async transition(id:string,stageId:string,revision:number,activity:number,accepting:boolean) {
  const event=await this.get(id);
  if(accepting===false&&event.current_stage_id===stageId){const guard=crypto.randomUUID();await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND activity_revision=?',Date.now(),id,revision,activity),this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_stages SET accepting=0 WHERE event_id=?',id),this.audit(id,'stage.changed',{stageId,accepting:false}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);return this.get(id);}

  if(!event.published_json) throw new Error('페이지를 먼저 공개해주세요.');
  const preview=await this.transitionPreview(id,stageId),draft=JSON.parse(event.published_json) as EventDraft;
  if(!preview.canTransition)throw new Error(preview.blockers[0]);
  assertPublishable(draft,preview.stage.kind);
  if(preview.stage.kind==='voting' && (!preview.candidates.length || preview.candidates.some(c=>!c.confirmed))) throw new Error('후보를 먼저 확정해주세요.');
  if(preview.stage.kind==='result' && !preview.result) throw new Error('결과 문구를 먼저 선택해주세요.');
  const policies=await this.policies(id);
  if(preview.stage.kind!=='result' && !policies.some(p=>p.stage_id===stageId && p.kind==='privacy')) throw new Error('개인정보 동의문을 저장해주세요.');
  const guard=crypto.randomUUID();
  await this.db.batch([
   this.statement("UPDATE events SET current_stage_id=?,revision=revision+1,updated_at=? WHERE id=? AND visibility='published' AND revision=? AND activity_revision=?",stageId,Date.now(),id,revision,activity),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   this.statement('UPDATE event_stages SET accepting=CASE WHEN id=? THEN ? ELSE 0 END WHERE event_id=?',stageId,Number(accepting && preview.stage.kind!=='result'),id),
   this.audit(id,'stage.changed',{stageId,accepting}),this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }

 async resetScope(id: string) {
  const event = await this.get(id);
  const counts: Record<string, number> = {};
  for (const table of RESET_TABLES) {
   const count = await this.statement(`SELECT count(*) AS n FROM ${table} WHERE event_id=?`, id).first<{n:number}>();
   counts[table] = count?.n ?? 0;
  }
  const current = await this.get(id);
  if (current.activity_revision !== event.activity_revision || current.revision !== event.revision) throw new Error('참여 현황이 변경되었습니다. 다시 확인해주세요.');
  return { eventId:id, title:event.title, revision:event.revision, activityRevision:event.activity_revision, counts };
 }
 async prepareReset(id: string, revision: number, activityRevision: number) {
  const scope = await this.resetScope(id);
  if (scope.revision !== revision || scope.activityRevision !== activityRevision) throw new Error('참여 현황이 변경되었습니다. 다시 확인해주세요.');
  const token = crypto.randomUUID()+crypto.randomUUID();
  await this.statement('INSERT INTO event_reset_tokens(token_hash,event_id,admin_id,expected_revision,expected_activity,scope_json,expires_at) VALUES(?,?,?,?,?,?,?)',await sha256Hex(token),id,this.actor,revision,activityRevision,JSON.stringify(scope.counts),Date.now()+300000).run();
  return { token, scope };
 }
 async reset(id: string, token: string, confirmation: string) {
  const event = await this.get(id);
  if (confirmation !== event.slug) throw new Error('이벤트 주소를 정확히 입력해주세요.');
  const hash = await sha256Hex(token);
  const challenge = await this.statement('SELECT * FROM event_reset_tokens WHERE token_hash=? AND event_id=? AND admin_id=? AND expires_at>?',hash,id,this.actor,Date.now()).first<{expected_revision:number;expected_activity:number;scope_json:string}>();
  if (!challenge) throw new Error('확인이 만료되었습니다. 처음부터 다시 확인해주세요.');
  const first = await this.statement("SELECT id FROM event_stages WHERE event_id=? AND kind='submission' ORDER BY position LIMIT 1",id).first<{id:string}>();
  if (!first) throw new Error('공모 단계가 없는 이벤트입니다.');
  const guard = crypto.randomUUID();
  await this.db.batch([
   this.statement('UPDATE events SET revision=revision+1,current_stage_id=?,updated_at=? WHERE id=? AND revision=? AND activity_revision=? AND EXISTS(SELECT 1 FROM event_reset_tokens WHERE token_hash=? AND event_id=? AND admin_id=? AND expires_at>?)',first.id,Date.now(),id,challenge.expected_revision,challenge.expected_activity,hash,id,this.actor,Date.now()),
   this.statement('INSERT INTO event_operation_guards VALUES(?,changes())',guard),
   ...RESET_TABLES.map(table=>this.statement(`DELETE FROM ${table} WHERE event_id=?`,id)),
   this.statement('UPDATE event_stages SET round=round+1,accepting=CASE WHEN id=? THEN 1 ELSE 0 END,starts_at=NULL,ends_at=NULL WHERE event_id=?',first.id,id),
   this.audit(id,'event.test_data_reset',JSON.parse(challenge.scope_json)),
   this.statement('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
  return this.get(id);
 }

}

// Foreign-key order, fixed allow-list. No caller can supply a table or omit the event predicate.
const RESET_TABLES = ['event_consents','event_identity_claims','event_vote_identities','event_participants','event_results','event_votes','event_candidates','event_entries','event_requests','event_rate_limits','event_reset_tokens'] as const;
