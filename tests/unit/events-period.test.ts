import {it,expect} from 'vitest';
import {eventPeriod,refreshEventPeriod} from '../../workers/data/src/events/period';
import {readFileSync} from 'node:fs';
import {memoryD1} from '../platform/sqlite-d1';
const log=(action:string,time:number,data={})=>({action,created_at:time,metadata_json:JSON.stringify(data)});
const published=log('event.published',10),open=log('stage.changed',20,{stageId:'submission',accepting:true});
const schedule=(time:number,start:number|null,end:number|null=null)=>log('stage.schedule_changed',time,{stageId:'submission',startsAt:start,endsAt:end});
it('uses actual opening, preserves it across reopens, ends on first final-stage transition',()=>{
 expect(eventPeriod(['submission','result'],[published,open,log('stage.changed',40,{stageId:'result'}),log('stage.changed',50,{stageId:'submission',accepting:true}),log('stage.changed',60,{stageId:'result'})],100)).toEqual({startedAt:20,endedAt:40});
});
it('waits for reservation, cancels unopened windows and handles late schedule edits',()=>{
 expect(eventPeriod(['submission','result'],[published,schedule(15,50),open],49).startedAt).toBeNull();
 expect(eventPeriod(['submission','result'],[published,schedule(15,50),open],50).startedAt).toBe(50);
 expect(eventPeriod(['submission','result'],[published,schedule(15,50),open,log('stage.changed',40,{stageId:'submission',accepting:false})],100).startedAt).toBeNull();
 expect(eventPeriod(['submission','result'],[published,schedule(15,50),open,schedule(30,5)],100).startedAt).toBe(30);
 expect(eventPeriod(['submission','result'],[published,schedule(15,5,19),open],100).startedAt).toBeNull();
});
it('handles publication, test resets, single-stage closure and unknown history',()=>{
 expect(eventPeriod(['submission'],[open,log('event.published',30),log('stage.changed',40,{stageId:'submission',accepting:false})],100)).toEqual({startedAt:30,endedAt:40});
 expect(eventPeriod(['submission','result'],[published,open,log('event.test_data_reset',40)],100)).toEqual({startedAt:40,endedAt:null});
 expect(eventPeriod(['submission','result'],[published,log('stage.changed',30,{stageId:'result'}),log('stage.changed',40,{stageId:'submission',accepting:true})],100)).toEqual({startedAt:null,endedAt:30});
 expect(eventPeriod(['submission','result'],[],100)).toEqual({startedAt:null,endedAt:null});
});
it('persists a reconstructed period to D1 without changing revision',async()=>{
 const memory=memoryD1(['0001_platform.sql','0009_event_period.sql'].map(f=>readFileSync('migrations/events/'+f,'utf8')).join('\n'));
 try{memory.sqlite.exec("INSERT INTO events(id,slug,title,draft_json,created_at,updated_at) VALUES('e','e','E','{}',0,0);INSERT INTO event_stages(event_id,id,kind,title,position) VALUES('e','submission','submission','',0),('e','result','result','',1)");for(const [i,l] of [published,open,log('stage.changed',40,{stageId:'result'})].entries())memory.sqlite.prepare('INSERT INTO event_audit(id,event_id,action,metadata_json,created_at) VALUES(?,?,?,?,?)').run(String(i),'e',l.action,l.metadata_json,l.created_at);await refreshEventPeriod(memory.db,'e',100);expect(memory.sqlite.prepare('SELECT started_at,ended_at,revision FROM events').get()).toEqual({started_at:20,ended_at:40,revision:1});memory.sqlite.exec('UPDATE events SET ended_at_override=35');await refreshEventPeriod(memory.db,'e',100);await refreshEventPeriod(memory.db,'e',200);expect(memory.sqlite.prepare('SELECT ended_at FROM events').get()!.ended_at).toBe(35);}finally{memory.sqlite.close();}
});
