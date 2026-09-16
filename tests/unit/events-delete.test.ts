import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {memoryD1} from '../platform/sqlite-d1';
import {EventsRepository} from '../../workers/data/src/events/repository';
import {firstSeat} from '../../packages/event-builder/src/model';
import {acceptParticipation,type ParticipationInput} from '../../workers/data/src/events/participation';
let memory:ReturnType<typeof memoryD1>,repo:EventsRepository;
beforeEach(()=>{memory=memoryD1(['0001_platform.sql','0002_assets.sql','0004_event_deletion.sql'].map(f=>readFileSync('migrations/events/'+f,'utf8')).join('\n'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('admin','subject','operator@seoularena.net',1,0); INSERT INTO platform_admins VALUES('other','other','other@seoularena.net',1,0)");repo=new EventsRepository(memory.db,'admin');});
afterEach(()=>memory.sqlite.close());
async function fixture(slug='delete-fixture'){
 let e=await repo.create({...firstSeat,slug,privacyPolicy:'Test policy',contactUrl:'mailto:test@example.invalid'});e=await repo.publish(e.id,e.revision);
 const p=await repo.transitionPreview(e.id,'submission');e=await repo.transition(e.id,'submission',p.revision,p.activityRevision,true);
 const input:ParticipationInput={eventId:e.id,stageId:'submission',round:1,revision:e.revision,participantId:crypto.randomUUID(),kind:'submission',message:'Test',candidateId:'',policyIds:(await repo.policies(e.id)).filter(p=>p.stage_id==='submission').map(p=>String(p.id)),envelope:{ciphertext:'test',iv:'test',wrappedDek:'test',keyVersion:'test'},masked:{name:'T',phone:'P',email:'E',instagram:''},identities:[],requestKey:crypto.randomUUID(),payloadHmac:'test',rateHmac:'test',identityKeyVersion:'test'};
 const accepted=await acceptParticipation(memory.db,input);await repo.review(e.id,accepted.id,'candidate',1);e=await repo.get(e.id);await repo.confirmCandidates(e.id,'voting',e.activity_revision);
 const v=await repo.transitionPreview(e.id,'voting');e=await repo.transition(e.id,'voting',v.revision,v.activityRevision,true);
 await acceptParticipation(memory.db,{...input,kind:'voting',stageId:'voting',revision:e.revision,candidateId:String(v.candidates[0]!.id),participantId:crypto.randomUUID(),requestKey:crypto.randomUUID(),identities:[{field:'phone',hash:'1'.repeat(64)},{field:'email',hash:'2'.repeat(64)}],policyIds:(await repo.policies(e.id)).filter(p=>p.stage_id==='voting').map(p=>String(p.id))});
 memory.sqlite.prepare('INSERT INTO event_assets VALUES(?,?,?,?,?,?)').run(e.id,'image','content',30,'image/webp',Date.now());
 return repo.get(e.id);
}
async function prepare(id:string){const s=await repo.deleteScope(id);return repo.prepareDelete(id,s.revision,s.activityRevision);}
it('atomically removes only the selected event and all of its related rows',async()=>{
 const e=await fixture(),other=await fixture('keep-fixture');
 const before=memory.sqlite.prepare('SELECT count(*) n FROM event_participants WHERE event_id=?').get(other.id)!.n;
 const ready=await prepare(e.id);expect(ready.scope.counts.event_votes).toBe(1);expect(ready.scope.counts.event_assets).toBe(1);
 await expect(repo.deleteEvent(e.id,ready.token,e.slug)).resolves.toEqual({deleted:true,id:e.id});
 for(const {name} of memory.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]){
  const cols=memory.sqlite.prepare(`PRAGMA table_info(${name})`).all() as {name:string}[];
  if(cols.some(c=>c.name==='event_id'))expect(memory.sqlite.prepare(`SELECT count(*) n FROM ${name} WHERE event_id=?`).get(e.id)!.n).toBe(0);
 }
 expect(memory.sqlite.prepare('SELECT count(*) n FROM events WHERE id=?').get(e.id)!.n).toBe(0);
 expect(memory.sqlite.prepare('SELECT count(*) n FROM event_operation_guards').get()!.n).toBe(0);
 expect(memory.sqlite.prepare('SELECT count(*) n FROM platform_admins').get()!.n).toBe(2);
 expect(memory.sqlite.prepare('SELECT count(*) n FROM event_participants WHERE event_id=?').get(other.id)!.n).toBe(before);
 await expect(repo.deleteEvent(e.id,ready.token,e.slug)).rejects.toThrow();
});
it('requires exact confirmation, matching actor, correct token purpose and unexpired confirmation',async()=>{
 const e=await fixture(),ready=await prepare(e.id);
 await expect(repo.deleteEvent(e.id,ready.token,'wrong')).rejects.toThrow();
 await expect(new EventsRepository(memory.db,'other').deleteEvent(e.id,ready.token,e.slug)).rejects.toThrow();
 await expect(repo.reset(e.id,ready.token,e.slug)).rejects.toThrow();
 const scope=await repo.resetScope(e.id),reset=await repo.prepareReset(e.id,scope.revision,scope.activityRevision);
 await expect(repo.deleteEvent(e.id,reset.token,e.slug)).rejects.toThrow();
 memory.sqlite.exec('UPDATE event_reset_tokens SET expires_at=0');
 await expect(repo.deleteEvent(e.id,ready.token,e.slug)).rejects.toThrow();
 expect((await repo.get(e.id)).visibility).toBe('published');
});
it('rolls back deletion after content or participation changes and preserves immutable records',async()=>{
 const e=await fixture(),ready=await prepare(e.id);
 expect(()=>memory.sqlite.prepare('DELETE FROM event_policies WHERE event_id=?').run(e.id)).toThrow('POLICY_IMMUTABLE');
 expect(()=>memory.sqlite.prepare('DELETE FROM event_audit WHERE event_id=?').run(e.id)).toThrow('AUDIT_IMMUTABLE');
 memory.sqlite.prepare('UPDATE events SET activity_revision=activity_revision+1 WHERE id=?').run(e.id);
 await expect(repo.deleteEvent(e.id,ready.token,e.slug)).rejects.toThrow();
 expect((await repo.get(e.id)).visibility).toBe('published');
 expect(memory.sqlite.prepare('SELECT count(*) n FROM event_votes WHERE event_id=?').get(e.id)!.n).toBe(1);
 const next=await prepare(e.id);const current=await repo.get(e.id);await repo.save(e.id,current.revision,JSON.parse(current.draft_json));
 await expect(repo.deleteEvent(e.id,next.token,e.slug)).rejects.toThrow();
 expect(memory.sqlite.prepare('SELECT count(*) n FROM event_operation_guards').get()!.n).toBe(0);
});
