export interface PeriodLog {action:string;metadata_json:string|null;created_at:number}
/** Replay opening windows, so a reservation cancelled before its start never counts. */
export function eventPeriod(stageIds:string[],logs:PeriodLog[],now:number){
 const first=stageIds[0],last=stageIds.at(-1);
 let current=first,published=false,accepting=false,openedAt:number|null=null;
 let startedAt:number|null=null,endedAt:number|null=null;
 const schedules=new Map<string,{start:number|null;end:number|null}>();
 function advance(at:number){
  if(startedAt!==null||endedAt!==null||!published||!accepting||current!==first||openedAt===null)return;
  const schedule=schedules.get(first!)??{start:null,end:null};
  const start=Math.max(openedAt,schedule.start??openedAt);
  if(start<=at&&(schedule.end===null||start<schedule.end))startedAt=start;
 }
 for(const log of logs){
  if(log.created_at>now)continue;
  advance(log.created_at);
  const data=JSON.parse(log.metadata_json??'{}');
  if(log.action==='event.test_data_reset'){
   startedAt=null;endedAt=null;current=first;accepting=true;openedAt=log.created_at;schedules.clear();
  }else if(log.action==='event.published'){
   if(!published&&accepting)openedAt=log.created_at;published=true;
  }else if(log.action==='event.archived'){published=false;openedAt=null;
  }else if(log.action==='stage.schedule_changed'){
   schedules.set(data.stageId,{start:data.startsAt??null,end:data.endsAt??null});
   // A retroactive schedule edit cannot make participation start before the edit.
   if(startedAt===null&&current===first&&accepting&&published)openedAt=log.created_at;
  }else if(log.action==='stage.changed'){
   if(published&&current!==data.stageId&&data.stageId===last&&endedAt===null)endedAt=log.created_at;
   if(stageIds.length===1&&startedAt!==null&&accepting&&!data.accepting&&endedAt===null)endedAt=log.created_at;
   const newlyOpened=current!==data.stageId||!accepting;
   current=data.stageId;accepting=Boolean(data.accepting);
   if(newlyOpened&&accepting)openedAt=log.created_at;
   if(!accepting)openedAt=null;
  }
  advance(log.created_at);
 }
 advance(now);
 return {startedAt,endedAt};
}
export async function refreshEventPeriod(db:D1Database,id:string,now=Date.now()){
 const snapshot=await db.prepare('SELECT revision,ended_at_override FROM events WHERE id=?').bind(id).first<{revision:number;ended_at_override:number|null}>();
 if(!snapshot)return {startedAt:null,endedAt:null};
 const stages=await db.prepare('SELECT id FROM event_stages WHERE event_id=? ORDER BY position').bind(id).all<{id:string}>();
 // rowid preserves insertion order when multiple actions have the same millisecond.
 const logs=await db.prepare("SELECT action,metadata_json,created_at FROM event_audit WHERE event_id=? AND action IN ('event.published','event.archived','event.test_data_reset','stage.changed','stage.schedule_changed') ORDER BY created_at,rowid").bind(id).all<PeriodLog>();
 const period=eventPeriod(stages.results.map(s=>s.id),logs.results,now);
 if(snapshot.ended_at_override!==null)period.endedAt=snapshot.ended_at_override;
 await db.prepare('UPDATE events SET started_at=?,ended_at=? WHERE id=? AND revision=? AND (started_at IS NOT ? OR ended_at IS NOT ?)').bind(period.startedAt,period.endedAt,id,snapshot.revision,period.startedAt,period.endedAt).run();
 return period;
}
export async function refreshEventPeriods(db:D1Database,now=Date.now()){
 const events=await db.prepare('SELECT id FROM events').all<{id:string}>();
 for(const event of events.results)await refreshEventPeriod(db,event.id,now);
}
