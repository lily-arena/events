import {monitoringStart,monitoringPeriods,type EventMonitoringData,type MonitoringPeriod,type MonitoringStageStatus} from '../../../../packages/domain/src/event-monitoring';
export async function recordPageView(db:D1Database,slug:string,visitId:string,now=Date.now()) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(visitId))throw new Error('Invalid page view');
 // A single statement validates publication and inserts the deduplicated receipt.
 // The aggregate trigger runs only for a newly inserted receipt, atomically.
 await db.prepare("INSERT OR IGNORE INTO event_pageview_receipts(event_id,visit_id,created_at) SELECT id,?,? FROM events WHERE slug=? AND visibility='published' AND published_json IS NOT NULL").bind(visitId,now,slug).run();
}
export async function readMonitoring(db:D1Database,eventId:string,period:MonitoringPeriod,now=Date.now()):Promise<EventMonitoringData> {
 if(!Object.hasOwn(monitoringPeriods,period))throw new Error('집계 단위를 확인해주세요.');
 const from=monitoringStart(period,now),{step,count}=monitoringPeriods[period];
 const q=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
 const results=await db.batch([
  q('SELECT tracking_started_at FROM event_monitoring_state WHERE event_id=?',eventId),
  q('SELECT CAST((bucket-?)/? AS INTEGER) AS slot,SUM(views) AS total FROM event_pageviews WHERE event_id=? AND bucket>=? AND bucket<=? GROUP BY slot',from,step,eventId,from,now),
  q('SELECT CAST((created_at-?)/? AS INTEGER) AS slot,COUNT(*) AS total FROM event_entries WHERE event_id=? AND created_at>=? AND created_at<=? GROUP BY slot',from,step,eventId,from,now),
  q('SELECT CAST((created_at-?)/? AS INTEGER) AS slot,COUNT(*) AS total FROM event_votes WHERE event_id=? AND created_at>=? AND created_at<=? GROUP BY slot',from,step,eventId,from,now),
  q('SELECT bucket,views FROM event_pageviews WHERE event_id=? AND bucket>=? AND bucket<?',eventId,Math.floor(now/900000)*900000-1800000,Math.floor(now/900000)*900000),
  q(`SELECT s.kind,s.position,s.accepting,s.starts_at,s.ends_at,e.current_stage_id,c.position AS current_position,
   CASE WHEN s.kind='submission' THEN EXISTS(SELECT 1 FROM event_entries WHERE event_id=e.id LIMIT 1) ELSE EXISTS(SELECT 1 FROM event_votes WHERE event_id=e.id LIMIT 1) END AS has_entries,
   EXISTS(SELECT 1 FROM event_audit a WHERE a.event_id=e.id AND a.action='stage.changed' AND json_extract(a.metadata_json,'$.stageId')=s.id AND json_extract(a.metadata_json,'$.accepting')=1) AS has_started
   FROM event_stages s JOIN events e ON e.id=s.event_id LEFT JOIN event_stages c ON c.event_id=e.id AND c.id=e.current_stage_id WHERE s.event_id=? AND s.kind IN ('submission','voting')`,eventId),
 ]);
 const started=(results[0]!.results[0] as {tracking_started_at:number}|undefined)?.tracking_started_at??null;
 const values=(index:number)=>new Map((results[index]!.results as unknown as {slot:number;total:number}[]).map(r=>[r.slot,r.total]));
 const views=values(1),submissions=values(2),votes=values(3),to=now;
 const points=Array.from({length:count},(_,i)=>({at:from+i*step,views:started===null||from+(i+1)*step<=started?null:views.get(i)??0,submissions:submissions.get(i)??0,votes:votes.get(i)??0}));
 const end=Math.floor(now/900000)*900000,rates=new Map((results[4]!.results as unknown as {bucket:number;views:number}[]).map(r=>[r.bucket,r.views]));
 const stageStatus:{submission:MonitoringStageStatus;voting:MonitoringStageStatus}={submission:'unused',voting:'unused'};
 for(const row of results[5]!.results as any[]){
  stageStatus[row.kind as 'submission'|'voting']=row.ends_at!==null&&row.ends_at<=now?'ended':row.kind===row.current_stage_id?(row.starts_at!==null&&row.starts_at>now?'pending':row.accepting?'active':row.has_entries||row.has_started?'paused':'pending'):row.position<row.current_position||row.has_entries?'ended':'pending';
 }
 return {period,from,to,generatedAt:now,trackingStartedAt:started,points,stageStatus,surge:started!==null&&started<=end-1800000?{current:rates.get(end-900000)??0,previous:rates.get(end-1800000)??0,from:end-900000,to:end}:null};
}
