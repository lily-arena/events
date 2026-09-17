import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryD1 } from '../platform/sqlite-d1';
import { EventsRepository } from '../../workers/data/src/events/repository';
import { firstSeat as seed } from '../../packages/event-builder/src/model';
const firstSeat={...seed,privacyPolicy:'로컬 테스트용 처리방침',contactUrl:'mailto:test@example.invalid'};
describe('Events persistence and scoped reset',()=>{
 let memory: ReturnType<typeof memoryD1>, repo: EventsRepository;
 beforeEach(()=>{memory=memoryD1(readFileSync('migrations/events/0001_platform.sql','utf8')+readFileSync('migrations/events/0002_assets.sql','utf8'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('admin','subject','operator@seoularena.net',1,0)");repo=new EventsRepository(memory.db,'admin');});
 afterEach(()=>memory.sqlite.close());
 it('creates independent events and rejects stale saves atomically',async()=>{
  const a=await repo.create(firstSeat), b=await repo.duplicate(a.id,'Second','second');
  expect(b.id).not.toBe(a.id); expect(b.visibility).toBe('draft');
  await repo.save(a.id,1,{...firstSeat,title:'Updated'});
  const count=memory.sqlite.prepare('SELECT count(*) n FROM event_audit').get()!.n;
  await expect(repo.save(a.id,1,{...firstSeat,title:'Stale'})).rejects.toThrow();
  expect((await repo.get(a.id)).title).toBe('Updated');
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_audit').get()!.n).toBe(count);
 });
 it('runs publication, review, candidate confirmation and result transition without another approver',async()=>{
  let a=await repo.create(firstSeat);
  a=await repo.publish(a.id,a.revision); // Consent details are optional.
  a=await repo.savePolicy(a.id,'submission','privacy','개인정보 동의 원문',a.revision);
  a=await repo.savePolicy(a.id,'submission','work-license','응모작 활용 원문',a.revision);
  a=await repo.savePolicy(a.id,'voting','privacy','투표 개인정보 동의 원문',a.revision);
  a=await repo.publish(a.id,a.revision);
  let preview=await repo.transitionPreview(a.id,'submission');
  a=await repo.transition(a.id,'submission',preview.revision,preview.activityRevision,true);
  memory.sqlite.prepare("INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(?,'entry','submission',1,'선정 문구',0)").run(a.id);
  await repo.review(a.id,'entry','candidate',1);
  const candidates=await repo.candidates(a.id,'voting'); expect(candidates.length).toBe(1);
  a=await repo.get(a.id); a=await repo.confirmCandidates(a.id,'voting',a.activity_revision);
  preview=await repo.transitionPreview(a.id,'voting');
  a=await repo.transition(a.id,'voting',preview.revision,preview.activityRevision,true);
  a=await repo.selectResult(a.id,'result','voting',candidates[0]!.id as string,a.revision);
  preview=await repo.transitionPreview(a.id,'result');
  expect(preview.result?.message).toBe('선정 문구');
  a=await repo.transition(a.id,'result',preview.revision,preview.activityRevision,false);
  expect(a.current_stage_id).toBe('result');
 });
 it('snapshots consent items independently of removed footer settings',async()=>{
  const draft=structuredClone(firstSeat);
  draft.pages.submission.find(m=>m.type==='consent')!.consents=[{id:'privacy',label:'개인정보 동의',body:''},{id:'work-license',label:'응모작 활용 동의',body:''},{id:'extra',label:'추가 확인',body:''}];
  let event=await repo.create(draft);event=await repo.publish(event.id,event.revision);
  const before=await repo.policies(event.id);
  const policy=before.find(p=>p.stage_id==='submission'&&p.kind==='privacy')!;
  expect(JSON.parse(String(policy.body))).toMatchObject({body:'',label:'개인정보 동의'});
  const ready=await repo.transitionPreview(event.id,'submission');expect(ready.canTransition).toBe(true);
  expect((await repo.transitionPreview(event.id,'voting')).blockers).toContain('후보를 먼저 확정해주세요.');
  event=await repo.transition(event.id,'submission',ready.revision,ready.activityRevision,true);
  expect((await repo.policies(event.id)).map(p=>p.id)).toEqual(before.map(p=>p.id));
  draft.pages.submission.find(m=>m.type==='consent')!.consents!.reverse();
  event=await repo.save(event.id,event.revision,draft);event=await repo.publish(event.id,event.revision);
  expect((await repo.policies(event.id)).map(p=>p.id)).toEqual(before.map(p=>p.id));
  draft.privacyPolicy='수정된 푸터 원문';event=await repo.save(event.id,event.revision,draft);event=await repo.publish(event.id,event.revision);
  const after=await repo.policies(event.id);
  expect(after.find(p=>p.stage_id==='submission'&&p.kind==='privacy')!.id).toBe(policy.id);
  expect(memory.sqlite.prepare('SELECT body FROM event_policies WHERE event_id=? AND id=?').get(event.id,policy.id)!.body).toBe(policy.body);
  draft.privacyPolicy='';event=await repo.save(event.id,event.revision,draft);
  await expect(repo.publish(event.id,event.revision)).resolves.toMatchObject({visibility:'published'});
 });
 it('versions optional consent changes and updates the server required flag',async()=>{
  const draft=structuredClone(firstSeat);const consent=draft.pages.submission.find(m=>m.type==='consent')!;
  consent.consents=[{id:'privacy',label:'정보 동의',body:'',required:true},{id:'work-license',label:'활용 동의',body:'',required:false}];
  let event=await repo.create(draft);event=await repo.publish(event.id,event.revision);
  const old=(await repo.policies(event.id)).find(p=>p.stage_id==='submission'&&p.kind==='work-license')!;
  expect(old.required).toBe(0);expect(JSON.parse(String(old.body)).required).toBe(false);
  consent.consents[1]!.required=true;event=await repo.save(event.id,event.revision,draft);await repo.publish(event.id,event.revision);
  const current=(await repo.policies(event.id)).find(p=>p.stage_id==='submission'&&p.kind==='work-license')!;
  expect(current.required).toBe(1);expect(current.id).not.toBe(old.id);
  expect(JSON.parse(String(memory.sqlite.prepare('SELECT body FROM event_policies WHERE event_id=? AND id=?').get(event.id,old.id)!.body)).required).toBe(false);
 });
 it('requires an active operator',async()=>{
  memory.sqlite.exec("UPDATE platform_admins SET active=0");
  await expect(repo.create(firstSeat)).rejects.toThrow('로그인');
 });
 it('resets only selected event and preserves configuration, policies, admins, audit',async()=>{
  const a=await repo.create(firstSeat),b=await repo.duplicate(a.id,'Second','second');
  for(const e of [a,b]) {
   memory.sqlite.prepare("UPDATE events SET visibility='published' WHERE id=?").run(e.id);
   memory.sqlite.prepare("UPDATE event_stages SET accepting=1 WHERE event_id=? AND id='submission'").run(e.id);
   memory.sqlite.prepare("INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(?,'entry','submission',1,'message',0)").run(e.id);
   memory.sqlite.prepare("INSERT INTO event_policies VALUES(?,'policy','privacy',1,'original','digest',0)").run(e.id);
  }
  const scope=await repo.resetScope(a.id), {token}=await repo.prepareReset(a.id,scope.revision,scope.activityRevision);
  await repo.reset(a.id,token,a.slug);
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_entries WHERE event_id=?').get(a.id)!.n).toBe(0);
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_entries WHERE event_id=?').get(b.id)!.n).toBe(1);
  expect(memory.sqlite.prepare('SELECT count(*) n FROM event_policies').get()!.n).toBe(2);
  expect((await repo.get(a.id)).draft_json).toBe(a.draft_json);
  expect(memory.sqlite.prepare("SELECT count(*) n FROM event_audit WHERE action='event.test_data_reset'").get()!.n).toBe(1);
  await expect(repo.reset(a.id,token,a.slug)).rejects.toThrow();
 });
 it('rejects reset if activity changes after confirmation',async()=>{
  const a=await repo.create(firstSeat); const scope=await repo.resetScope(a.id);
  const {token}=await repo.prepareReset(a.id,scope.revision,scope.activityRevision);
  memory.sqlite.prepare("UPDATE events SET activity_revision=activity_revision+1 WHERE id=?").run(a.id);
  await expect(repo.reset(a.id,token,a.slug)).rejects.toThrow();
  expect((await repo.get(a.id)).revision).toBe(1);
 });
});
