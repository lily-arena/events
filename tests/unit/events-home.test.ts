import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {memoryD1} from '../platform/sqlite-d1';
import {EventsRepository} from '../../workers/data/src/events/repository';
import {publicCatalog} from '../../workers/data/src/events/catalog';
import {firstSeat} from '../../packages/event-builder/src/model';
let memory:ReturnType<typeof memoryD1>,repo:EventsRepository,id:string;
beforeEach(async()=>{memory=memoryD1(['0001_platform.sql','0002_assets.sql','0004_event_deletion.sql','0008_home_exposure.sql','0009_event_period.sql'].map(f=>readFileSync('migrations/events/'+f,'utf8')).join('\n'));memory.sqlite.exec("INSERT INTO platform_admins VALUES('a','a','a@seoularena.net',1,0)");repo=new EventsRepository(memory.db,'a');id=(await repo.create(firstSeat)).id;});
afterEach(()=>memory.sqlite.close());
it('only exposes published titles; existing events default to past',async()=>{expect(await publicCatalog(memory.db)).toEqual([]);memory.sqlite.prepare("UPDATE events SET visibility='published',published_json=draft_json,title='PRIVATE DRAFT' WHERE id=?").run(id);expect(await publicCatalog(memory.db)).toEqual([{title:'FIRST SEAT',href:'/first-seat',active:false,image:null,startsAt:null,resultsAt:null}]);memory.sqlite.prepare("UPDATE events SET visibility='archived' WHERE id=?").run(id);expect(await publicCatalog(memory.db)).toEqual([]);});
it('switches exposure with concurrency protection and audit without changing stage or schedule',async()=>{await expect(repo.homeExposure(id,1,true)).rejects.toThrow('공개');memory.sqlite.prepare("UPDATE events SET visibility='published',published_json=draft_json WHERE id=?").run(id);const before=await repo.get(id);const stage=memory.sqlite.prepare('SELECT * FROM event_stages WHERE event_id=?').all(id);const row=await repo.homeExposure(id,before.revision,true);expect(row.home_active).toBe(1);expect(row.current_stage_id).toBe(before.current_stage_id);expect(row.published_json).toBe(before.published_json);expect(memory.sqlite.prepare('SELECT * FROM event_stages WHERE event_id=?').all(id)).toEqual(stage);await expect(repo.homeExposure(id,before.revision,false)).rejects.toThrow('EDIT_CONFLICT');expect((await publicCatalog(memory.db))[0].active).toBe(true);await repo.homeExposure(id,row.revision,false);expect((await publicCatalog(memory.db))[0].active).toBe(false);expect(memory.sqlite.prepare("SELECT count(*) n FROM event_audit WHERE action='event.home_exposure'").get()!.n).toBe(2);await expect(new EventsRepository(memory.db,'outsider').homeExposure(id,row.revision,false)).rejects.toThrow('로그인');});

it('catalog uses published header and operational dates, never a draft header',async()=>{
 const published=JSON.parse((await repo.get(id)).draft_json);
 const asset='11111111-1111-4111-8111-111111111111';
 published.pages.submission=[{type:'header-image',imageAssetId:asset}];
 memory.sqlite.prepare("UPDATE events SET visibility='published',current_stage_id='submission',published_json=? WHERE id=?").run(JSON.stringify(published),id);
 memory.sqlite.prepare('UPDATE events SET started_at=?,ended_at=?,ended_at_override=? WHERE id=?').run(1790000000000,1791000000000,1791000000000,id);
 expect((await publicCatalog(memory.db))[0]).toMatchObject({image:'/api/events/first-seat/assets/'+asset,startsAt:1790000000000,resultsAt:1791000000000});
});
