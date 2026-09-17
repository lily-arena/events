import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {memoryD1} from '../platform/sqlite-d1';
import {EventsRepository} from '../../workers/data/src/events/repository';
import {firstSeat} from '../../packages/event-builder/src/model';
let memory:ReturnType<typeof memoryD1>,a:EventsRepository,b:EventsRepository;
beforeEach(()=>{memory=memoryD1(['0001_platform.sql','0002_assets.sql'].map(f=>readFileSync('migrations/events/'+f,'utf8')).join('\n'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('a','a','a@seoularena.net',1,0); INSERT INTO platform_admins VALUES('b','b','b@seoularena.net',1,0)");a=new EventsRepository(memory.db,'a');b=new EventsRepository(memory.db,'b');});
afterEach(()=>memory.sqlite.close());
const create=()=>a.create({...firstSeat,slug:'edit-race',privacyPolicy:'Privacy original',contactUrl:'mailto:test@example.invalid'});
it('rejects a second editor using a stale revision without overwriting the first save',async()=>{
 const row=await create(),copy=await b.get(row.id);const saved=await a.save(row.id,row.revision,{...JSON.parse(row.draft_json),title:'A saved'});
 await expect(b.save(copy.id,copy.revision,{...JSON.parse(copy.draft_json),title:'B stale'})).rejects.toThrow('EDIT_CONFLICT');
 expect(JSON.parse((await a.get(row.id)).draft_json).title).toBe('A saved');expect(saved.revision).toBe(row.revision+1);
 expect(await b.editState(row.id)).toMatchObject({revision:saved.revision});
});
it('saves and publishes exactly the submitted snapshot in one revision',async()=>{
 const row=await create();const next=await a.save(row.id,row.revision,{...JSON.parse(row.draft_json),title:'Publish A',editorRevision:row.revision},true);
 expect(next.revision).toBe(row.revision+1);expect(next.visibility).toBe('published');expect(next.published_json).toBe(next.draft_json);expect(JSON.parse(next.draft_json).editorRevision).toBeUndefined();
 await expect(b.save(row.id,row.revision,{...JSON.parse(row.draft_json),title:'Publish B'},true)).rejects.toThrow('EDIT_CONFLICT');
 expect(JSON.parse((await a.get(row.id)).published_json!).title).toBe('Publish A');
});
it('keeps both old draft and public page when atomic publication validation fails',async()=>{
 const row=await create(),published=await a.publish(row.id,row.revision);
 await expect(a.save(row.id,published.revision,{...JSON.parse(published.draft_json),title:'Do not save',pages:{...JSON.parse(published.draft_json).pages,submission:[]}},true)).rejects.toThrow();
 expect(await a.get(row.id)).toEqual(published);
});
it('rolls back all content when a dependent policy write fails',async()=>{
 const row=await create();memory.sqlite.exec("CREATE TRIGGER fail_policy BEFORE INSERT ON event_policies BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;");
 await expect(a.save(row.id,row.revision,{...JSON.parse(row.draft_json),title:'Rollback'},true)).rejects.toThrow();
 expect(await a.get(row.id)).toEqual(row);expect(memory.sqlite.prepare('SELECT count(*) n FROM event_operation_guards').get()!.n).toBe(0);
});
it('never publishes another editor snapshot through an old publish request',async()=>{
 const row=await create();await a.save(row.id,row.revision,{...JSON.parse(row.draft_json),title:'New draft'});
 await expect(b.publish(row.id,row.revision)).rejects.toThrow('EDIT_CONFLICT');
 expect((await a.get(row.id)).published_json).toBeNull();
});
