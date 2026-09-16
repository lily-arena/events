import {checkVote} from './vote-check';
import {purgeExpired} from './retention';
import { WorkerEntrypoint } from 'cloudflare:workers';
import {acceptParticipation,type ParticipationInput} from './participation';
import { EventsRepository } from './repository';
import type { EventRow } from './repository';
interface Env { DB: D1Database; ENVIRONMENT: string }
interface Identity { subject: string; email: string; provider: string }
export class AdminEventsData extends WorkerEntrypoint<Env> {
 private async repository(identity: Identity) {
  if (identity.provider === 'local' && this.env.ENVIRONMENT !== 'local') throw new Error('허용되지 않은 인증입니다.');
  if (identity.provider !== 'google' && identity.provider !== 'local') throw new Error('로그인이 필요합니다.');
  if (!identity.subject || !/^[^@]+@seoularena\.net$/.test(identity.email)) throw new Error('회사 계정으로 로그인해주세요.');
  // This entrypoint is private: only the authenticated Admin Worker receives its service binding.
  const subject = `${identity.provider}:${identity.subject}`;
  let admin=await this.env.DB.prepare('SELECT id,active FROM platform_admins WHERE subject=?').bind(subject).first<{id:string;active:number}>();
  if(!admin){await this.env.DB.prepare('INSERT INTO platform_admins(id,subject,email,created_at) VALUES(?,?,?,?) ON CONFLICT(subject) DO NOTHING').bind(crypto.randomUUID(),subject,identity.email,Date.now()).run();admin=await this.env.DB.prepare('SELECT id,active FROM platform_admins WHERE subject=?').bind(subject).first<{id:string;active:number}>();}
  if (!admin?.active) throw new Error('접근 권한이 없습니다.');
  return new EventsRepository(this.env.DB,admin.id,true);
 }
 async list(identity: Identity) {return (await this.repository(identity)).list();}
 async get(identity: Identity,id:string) {return (await this.repository(identity)).get(id);}
 async create(identity: Identity,input:unknown) {return (await this.repository(identity)).create(input);}
 async save(identity: Identity,id:string,revision:number,input:unknown) {return (await this.repository(identity)).save(id,revision,input);}
 async duplicate(identity: Identity,id:string,title:string,slug:string) {return (await this.repository(identity)).duplicate(id,title,slug);}
 async archive(identity: Identity,id:string,revision:number) {return (await this.repository(identity)).archive(id,revision);}
 async deleteScope(identity:Identity,id:string) {return (await this.repository(identity)).deleteScope(id);}
 async prepareDelete(identity:Identity,id:string,revision:number,activity:number) {return (await this.repository(identity)).prepareDelete(id,revision,activity);}
 async deleteEvent(identity:Identity,id:string,token:string,confirmation:string) {return (await this.repository(identity)).deleteEvent(id,token,confirmation);}
 async resetScope(identity: Identity,id:string) {return (await this.repository(identity)).resetScope(id);}
 async prepareReset(identity: Identity,id:string,revision:number,activity:number) {return (await this.repository(identity)).prepareReset(id,revision,activity);}
 async reset(identity: Identity,id:string,token:string,confirmation:string) {return (await this.repository(identity)).reset(id,token,confirmation);}
 async schedule(identity:Identity,id:string,stage:string,starts:number|null,ends:number|null,revision:number){return (await this.repository(identity)).schedule(id,stage,starts,ends,revision);}
 async uploadAsset(identity:Identity,id:string,content:string){return (await this.repository(identity)).uploadAsset(id,content);}
 async asset(identity:Identity,id:string,assetId:string){return (await this.repository(identity)).asset(id,assetId);}
 async entries(identity:Identity,id:string) {return (await this.repository(identity)).entries(id);}
 async reviewEntries(identity:Identity,id:string,status:string,query:string,page:number){return (await this.repository(identity)).reviewEntries(id,status,query,page);}
 async policies(identity:Identity,id:string) {return (await this.repository(identity)).policies(id);}
 async savePolicy(identity:Identity,id:string,stage:string,kind:string,body:string,revision:number) {return (await this.repository(identity)).savePolicy(id,stage,kind,body,revision);}
 async publish(identity:Identity,id:string,revision:number) {return (await this.repository(identity)).publish(id,revision);}
 async candidates(identity:Identity,id:string,stage:string) {return (await this.repository(identity)).candidates(id,stage);}
 async review(identity:Identity,id:string,entry:string,status:string,revision:number) {return (await this.repository(identity)).review(id,entry,status,revision);}
 async reorderCandidates(identity:Identity,id:string,stage:string,ids:string[],activity:number){return (await this.repository(identity)).reorderCandidates(id,stage,ids,activity);}
 async participantPage(identity:Identity,id:string,page:number){return (await this.repository(identity)).participantPage(id,page);}
 async confirmCandidates(identity:Identity,id:string,stage:string,activity:number) {return (await this.repository(identity)).confirmCandidates(id,stage,activity);}
 async selectResult(identity:Identity,id:string,stage:string,voting:string,candidate:string,revision:number) {return (await this.repository(identity)).selectResult(id,stage,voting,candidate,revision);}
 async transitionPreview(identity:Identity,id:string,stage:string) {return (await this.repository(identity)).transitionPreview(id,stage);}
 async transition(identity:Identity,id:string,stage:string,revision:number,activity:number,accepting:boolean) {return (await this.repository(identity)).transition(id,stage,revision,activity,accepting);}
 async revealEnvelope(identity:Identity,id:string,participantId:string){return (await this.repository(identity)).revealEnvelope(id,participantId);}
 async revealOutcome(identity:Identity,id:string,participantId:string,success:boolean){return (await this.repository(identity)).revealOutcome(id,participantId,success);}
 async deletePrivate(identity:Identity,id:string,participantId:string){return (await this.repository(identity)).deletePrivate(id,participantId);}
 async participants(identity:Identity,id:string){return (await this.repository(identity)).participants(id);}
 async auditLog(identity:Identity,id:string){return (await this.repository(identity)).auditLog(id);}

}
export class PublicEventsData extends WorkerEntrypoint<Env> {
 async image(slug:string,assetId:string) {
  const view=await this.event(slug);
  if(!view||!Object.values(view.event.pages).flat().some((m:any)=>m.imageAssetId===assetId))return null;
  return this.env.DB.prepare('SELECT content_base64,mime FROM event_assets WHERE event_id=? AND id=?').bind(view.event.id,assetId).first<{content_base64:string;mime:string}>();
 }
 async checkVote(eventId:string,stageId:string,round:number,identities:ParticipationInput['identities'],rateHmac:string) {return checkVote(this.env.DB,eventId,stageId,round,identities,rateHmac);}
 async participate(input:ParticipationInput) {return acceptParticipation(this.env.DB,input);}
 async event(slug: string) {
  const row = await this.env.DB.prepare("SELECT id,published_json,current_stage_id,revision FROM events WHERE slug=? AND visibility='published' AND published_json IS NOT NULL").bind(slug).first<Pick<EventRow,'id'|'published_json'|'current_stage_id'|'revision'>>();
  if (!row) return null;
  const stage = await this.env.DB.prepare('SELECT id,kind,title,starts_at,ends_at,accepting,round,max_length,allow_repeat FROM event_stages WHERE event_id=? AND id=?').bind(row.id,row.current_stage_id).first();
  const policies=(await this.env.DB.prepare('SELECT p.id,p.kind,p.version,p.body,s.required FROM stage_policies s JOIN event_policies p ON p.event_id=s.event_id AND p.id=s.policy_id WHERE s.event_id=? AND s.stage_id=?').bind(row.id,row.current_stage_id).all()).results;
  const candidates=(await this.env.DB.prepare('SELECT c.id,c.message FROM event_candidates c JOIN event_stages s ON s.event_id=c.event_id AND s.id=c.stage_id AND s.round=c.round WHERE c.event_id=? AND c.stage_id=? AND c.confirmed=1 ORDER BY c.position').bind(row.id,row.current_stage_id).all()).results;
  const result=await this.env.DB.prepare('SELECT c.message FROM event_results r JOIN event_candidates c ON c.event_id=r.event_id AND c.stage_id=r.voting_stage_id AND c.round=r.round AND c.id=r.candidate_id WHERE r.event_id=? AND r.stage_id=?').bind(row.id,row.current_stage_id).first();
  const published=JSON.parse(row.published_json!);
  // Public clients only receive the active published page, never future-stage copy or drafts.
  published.pages=Object.fromEntries(['submission','voting','result'].map(kind=>[kind,kind===stage?.kind?published.pages[kind]:[]]));
  return {event:published,stage,policies,candidates,result,revision:row.revision};
 }
}
export default {async scheduled(_event:ScheduledController,env:Env){await purgeExpired(env.DB);},fetch() { return new Response(null,{status:404}); }};
