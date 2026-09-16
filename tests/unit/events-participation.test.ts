import { readFileSync } from 'node:fs';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { memoryD1 } from '../platform/sqlite-d1';
import { EventsRepository } from '../../workers/data/src/events/repository';
import { firstSeat as seed } from '../../packages/event-builder/src/model';
import {acceptParticipation,type ParticipationInput} from '../../workers/data/src/events/participation';
const firstSeat={...seed,privacyPolicy:'로컬 테스트용 처리방침',contactUrl:'mailto:test@example.invalid'};
describe('atomic participation and duplicate voting',()=>{
 let memory:ReturnType<typeof memoryD1>,repo:EventsRepository;
 beforeEach(()=>{memory=memoryD1(readFileSync('migrations/events/0001_platform.sql','utf8')+readFileSync('migrations/events/0002_assets.sql','utf8'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('admin','subject','operator@seoularena.net',1,0)");repo=new EventsRepository(memory.db,'admin');});
 afterEach(()=>memory.sqlite.close());
 async function event(slug:string){
  let e=await repo.create({...firstSeat,slug});
  for(const [stage,kind] of [['submission','privacy'],['submission','work-license'],['voting','privacy']])e=await repo.savePolicy(e.id,stage!,kind!,'동의문 원문',e.revision);
  e=await repo.publish(e.id,e.revision);const p=await repo.transitionPreview(e.id,'submission');return repo.transition(e.id,'submission',p.revision,p.activityRevision,true);
 }
 async function input(eventId:string,kind:'submission'|'voting'):Promise<ParticipationInput>{
  const e=await repo.get(eventId),policies=await repo.policies(eventId);
  return {eventId,stageId:kind,round:1,revision:e.revision,participantId:crypto.randomUUID(),kind,message:'첫 기록',candidateId:'',policyIds:policies.filter(p=>p.stage_id===kind).map(p=>p.id as string),envelope:{ciphertext:'encrypted-test',iv:'test',wrappedDek:'wrapped-test',keyVersion:'test-v1'},masked:{name:'가*',phone:'+82*****5678',email:'p***@e******.com',instagram:kind==='voting'?'a***':''},identities:['phone','email','instagram'].map((field,i)=>({field:field as 'phone'|'email'|'instagram',hash:String(i+1).repeat(64)})),requestKey:crypto.randomUUID(),payloadHmac:'payload-test',rateHmac:'rate-test',identityKeyVersion:'test-v1'};
 }
 async function openVoting(id:string){
  const submission=await input(id,'submission');const accepted=await acceptParticipation(memory.db,submission);
  await repo.review(id,accepted.id,'candidate',1);let e=await repo.get(id);e=await repo.confirmCandidates(id,'voting',e.activity_revision);
  const preview=await repo.transitionPreview(id,'voting');await repo.transition(id,'voting',preview.revision,preview.activityRevision,true);
  const vote=await input(id,'voting');vote.candidateId=preview.candidates[0]!.id as string;return vote;
 }
 it('stores consent versions and returns the same receipt on retry',async()=>{
  const e=await event('first');const submission=await input(e.id,'submission');
  const a=await acceptParticipation(memory.db,submission),b=await acceptParticipation(memory.db,submission);
  expect(a).toEqual(b);expect(memory.sqlite.prepare('SELECT count(*) n FROM event_entries').get()!.n).toBe(1);
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_consents').get()!.n).toBe(2);
 });
 it('blocks any repeated identity and rolls back the entire second vote',async()=>{
  const e=await event('first'),vote=await openVoting(e.id);
  await acceptParticipation(memory.db,vote);
  const repeat={...vote,requestKey:crypto.randomUUID(),participantId:crypto.randomUUID(),identities:vote.identities.map(i=>i.field==='phone'?i:{...i,hash:'a'.repeat(64)})};
  await expect(acceptParticipation(memory.db,repeat)).rejects.toThrow();
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_votes').get()!.n).toBe(1);
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_participants').get()!.n).toBe(2);
 });
 it('allows repeats when configured and enforces claims when switched back',async()=>{
  const e=await event('first'),vote=await openVoting(e.id);
  let row=await repo.get(e.id);row=await repo.save(e.id,row.revision,{...JSON.parse(row.draft_json),allowRepeatVotes:true});row=await repo.publish(e.id,row.revision);
  vote.revision=row.revision;await acceptParticipation(memory.db,vote);
  await acceptParticipation(memory.db,{...vote,requestKey:crypto.randomUUID(),participantId:crypto.randomUUID()});
  row=await repo.save(e.id,row.revision,{...JSON.parse(row.draft_json),allowRepeatVotes:false});row=await repo.publish(e.id,row.revision);
  await expect(acceptParticipation(memory.db,{...vote,revision:row.revision,requestKey:crypto.randomUUID(),participantId:crypto.randomUUID()})).rejects.toThrow();
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_votes').get()!.n).toBe(2);
 });
 it('rejects outdated consent versions before storing any contact',async()=>{
  const e=await event('first'),submission=await input(e.id,'submission');
  const next=await repo.savePolicy(e.id,'submission','privacy','수정 원문',e.revision);submission.revision=next.revision;
  await expect(acceptParticipation(memory.db,submission)).rejects.toThrow('동의문');
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_participants').get()!.n).toBe(0);
 });
});
