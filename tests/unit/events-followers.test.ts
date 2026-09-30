import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {memoryD1} from '../platform/sqlite-d1';
import {EventsRepository} from '../../workers/data/src/events/repository';
import {Followers} from '../../workers/data/src/events/followers';
import {weightedDraw,normalizeInstagram,weightUnits} from '../../packages/domain/src/follower-draw';
import {identityHashes} from '../../packages/security/src/event-participant';
import {hmacSha256Hex} from '../../packages/security/src/hash';
import {firstSeat} from '../../packages/event-builder/src/model';
let memory:ReturnType<typeof memoryD1>,repo:EventsRepository,event:string;
beforeEach(async()=>{memory=memoryD1(['0001_platform.sql','0002_assets.sql','0004_event_deletion.sql','0007_followers.sql'].map(f=>readFileSync('migrations/events/'+f,'utf8')).join('\n'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('a','a','a@seoularena.net',1,0);INSERT INTO platform_admins VALUES('b','b','b@seoularena.net',1,0)");repo=new EventsRepository(memory.db,'a');event=(await repo.create({...firstSeat,slug:'follower-test'})).id;memory.sqlite.prepare("UPDATE events SET visibility='published',current_stage_id='submission' WHERE id=?").run(event);memory.sqlite.prepare("UPDATE event_stages SET accepting=1 WHERE event_id=?").run(event);memory.sqlite.prepare("INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(?,'e','submission',1,'test',0)").run(event);memory.sqlite.prepare("INSERT INTO event_candidates(event_id,stage_id,round,id,entry_id,message,position,confirmed) VALUES(?,'voting',1,'c','e','test',0,1)").run(event);memory.sqlite.prepare("UPDATE events SET current_stage_id='voting' WHERE id=?").run(event);});
afterEach(()=>memory.sqlite.close());
function vote(id:string,hash?:string){memory.sqlite.prepare("INSERT INTO event_votes VALUES(?,?,'voting',1,'c',0)").run(event,id);memory.sqlite.prepare("INSERT INTO event_participants VALUES(?,?,NULL,?,'{}','test','{}',9999999999999)").run(event,'p'+id,id);if(hash)memory.sqlite.prepare("INSERT INTO event_vote_identities VALUES(?,?,'voting',1,'instagram',?,'v1')").run(event,id,hash);}
async function upload(hashes:string[],previous:string|null=null){const f=await repo.followerBegin(event,'2026-09-30',previous);if(hashes.length)await repo.followerChunk(event,f.id,0,hashes);await repo.followerApply(event,f.id,hashes.length?1:0,hashes.length);return f.id;}
it('matches old and future votes; absent IDs stay unknown; snapshots replace atomically',async()=>{
 const h='a'.repeat(64);vote('1',h);vote('2','b'.repeat(64));vote('3');
 expect((await repo.participantPage(event,1,'voting')).entries.every(p=>p.follow_status==='unknown')).toBe(true);
 const first=await upload([h]);let result=await repo.participantPage(event,1,'voting');expect(result.entries.map(p=>p.follow_status)).toEqual(['following','not_following','unknown']);expect(result.followingCount).toBe(1);
 vote('4',h);expect((await repo.participantPage(event,1,'voting')).followingCount).toBe(2);
 const next=await repo.followerBegin(event,null,first);await repo.followerChunk(event,next.id,0,['b'.repeat(64)]);
 expect((await repo.participantPage(event,1,'voting')).followingCount).toBe(2);
 await expect(repo.followerApply(event,next.id,2,1)).rejects.toThrow();expect((await new Followers(memory.db,'a').metadata(event))?.id).toBe(first);
 await repo.followerApply(event,next.id,1,1);expect((await repo.participantPage(event,1,'voting')).followingCount).toBe(1);
 await expect(repo.drawParticipants(event,'voting',1,3,first)).rejects.toThrow('변경');
 expect((await repo.drawParticipants(event,'voting',4,3,next.id)).entries).toHaveLength(4);
 expect(memory.sqlite.prepare('SELECT count(*) n FROM event_follower_imports').get()!.n).toBe(1);
});
it('enforces ownership, event boundaries, repeat chunks and concurrent replacement',async()=>{
 const f=await repo.followerBegin(event,null,null);await repo.followerChunk(event,f.id,0,['a'.repeat(64)]);await repo.followerChunk(event,f.id,0,['a'.repeat(64)]);
 await expect(repo.followerChunk(event,f.id,0,['b'.repeat(64)])).rejects.toThrow();
 await expect(new EventsRepository(memory.db,'b').followerApply(event,f.id,1,1)).rejects.toThrow();
 const other=await repo.create({...firstSeat,slug:'other'});await expect(repo.followerApply(other.id,f.id,1,1)).rejects.toThrow();
 const concurrent=await repo.followerBegin(event,null,null);await repo.followerApply(event,f.id,1,1);await expect(repo.followerApply(event,concurrent.id,0,0)).rejects.toThrow();
 await expect(repo.followerBegin(event,'2026-02-30',f.id)).rejects.toThrow();
});
it('clears scoped data on reset rounds and cascades on event deletion',async()=>{
 const id=await upload(['a'.repeat(64)]);memory.sqlite.prepare("UPDATE event_stages SET round=round+1 WHERE event_id=? AND id='voting'").run(event);expect(await new Followers(memory.db,'a').metadata(event)).toBeNull();expect(memory.sqlite.prepare('SELECT count(*) n FROM event_follower_members').get()!.n).toBe(0);
 await upload([]);const scope=await repo.deleteScope(event);const challenge=await repo.prepareDelete(event,scope.revision,scope.activityRevision);await repo.deleteEvent(event,challenge.token,'follower-test');expect(memory.sqlite.prepare('SELECT count(*) n FROM event_follower_imports').get()!.n).toBe(0);
});
it('uses precisely the same scoped HMAC as participation',async()=>{
 const username=normalizeInstagram(' @Example_One ');const hashes=await identityHashes('secret',event,'voting',1,{name:'',phone:'',email:'',instagram:username});expect(hashes[0]?.hash).toBe(await hmacSha256Hex('secret',JSON.stringify(['events-v1',event,'voting',1,'instagram',username])));
});
it('weights exact selection intervals, removes winners, and validates multipliers',()=>{
 const rows=[{id:1,follow_status:'unknown'},{id:2,follow_status:'following'},{id:3,follow_status:'not_following'}];
 const frequencies=[0,0,0];for(let i=0;i<50;i++){const r=weightedDraw(rows,1,3,()=>i);frequencies[r[0]!.id-1]++;}expect(frequencies).toEqual([10,30,10]);
 expect(new Set(weightedDraw(rows,3,100,n=>n-1).map(p=>p.id)).size).toBe(3);expect(weightUnits(1.1)).toBe(11);for(const invalid of [0,101,NaN,1.11])expect(()=>weightUnits(invalid)).toThrow();
});
