import type {ParticipationInput} from './participation';
export async function hasDuplicateVote(db:D1Database,eventId:string,stageId:string,round:number,identities:ParticipationInput['identities']) {
 if(!identities.length)return false;
 const conditions=identities.map(()=>'(field=? AND identity_hmac=?)').join(' OR ');
 const row=await db.prepare(`SELECT 1 AS found FROM event_identity_claims WHERE event_id=? AND stage_id=? AND round=? AND (${conditions}) LIMIT 1`).bind(eventId,stageId,round,...identities.flatMap(i=>[i.field,i.hash])).first();
 return !!row;
}
export async function checkVote(db:D1Database,eventId:string,stageId:string,round:number,identities:ParticipationInput['identities'],rateHmac:string) {
 const rate=await db.prepare('INSERT INTO event_rate_limits VALUES(?,?,?,1) ON CONFLICT(event_id,subject_hmac,window) DO UPDATE SET count=count+1 RETURNING count').bind(eventId,rateHmac,Math.floor(Date.now()/300000)).first<{count:number}>();
 if((rate?.count??99)>60)throw new Error('조회 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.');
 const stage=await db.prepare("SELECT s.allow_repeat FROM event_stages s JOIN events e ON e.id=s.event_id AND e.current_stage_id=s.id WHERE s.event_id=? AND s.id=? AND s.round=? AND s.kind='voting' AND e.visibility='published'").bind(eventId,stageId,round).first<{allow_repeat:number}>();
 if(!stage)throw new Error('투표 상태가 변경되었습니다.');
 return {duplicate:!stage.allow_repeat&&await hasDuplicateVote(db,eventId,stageId,round,identities)};
}
