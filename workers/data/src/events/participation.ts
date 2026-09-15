import type { ParticipantEnvelope } from '../../../../packages/security/src/event-participant';
export interface ParticipationInput {
 eventId:string; stageId:string; round:number; revision:number; participantId:string;
 kind:'submission'|'voting'; message:string; candidateId:string; policyIds:string[];
 envelope:ParticipantEnvelope; masked:Record<string,string>;
 identities:{field:'phone'|'email'|'instagram';hash:string}[];
 requestKey:string;payloadHmac:string;rateHmac:string;identityKeyVersion:string;
}
export async function acceptParticipation(db:D1Database,input:ParticipationInput) {
 const q=(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
 const prior=async()=>q('SELECT payload_hmac,response_json FROM event_requests WHERE event_id=? AND stage_id=? AND round=? AND request_key=?',input.eventId,input.stageId,input.round,input.requestKey).first<{payload_hmac:string;response_json:string}>();
 const restore=(row:{payload_hmac:string;response_json:string})=>{if(row.payload_hmac!==input.payloadHmac)throw new Error('요청 내용이 변경되었습니다. 다시 시도해주세요.');return JSON.parse(row.response_json);};
 const previous=await prior();if(previous)return restore(previous);
 const stage=await q('SELECT s.*,e.revision,e.visibility,e.published_json FROM event_stages s JOIN events e ON e.id=s.event_id AND e.current_stage_id=s.id WHERE s.event_id=? AND s.id=?',input.eventId,input.stageId).first<{kind:string;round:number;revision:number;max_length:number;allow_repeat:number;published_json:string}>();
 if(!stage || stage.kind!==input.kind || stage.round!==input.round || stage.revision!==input.revision)throw new Error('이벤트 상태가 변경되었습니다. 다시 확인해주세요.');
 const policies=(await q('SELECT policy_id,required FROM stage_policies WHERE event_id=? AND stage_id=?',input.eventId,input.stageId).all<{policy_id:string;required:number}>()).results;
 if(!policies.length || policies.some(p=>p.required && !input.policyIds.includes(p.policy_id)) || input.policyIds.some(id=>!policies.some(p=>p.policy_id===id)))throw new Error('동의문을 다시 확인해주세요.');
 const message=input.message.normalize('NFC').trim();
 const length=[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(message)].length;
 if(input.kind==='submission' && (!length || length>stage.max_length))throw new Error('응모 문구의 글자 수를 확인해주세요.');
 if(input.kind==='voting' && (input.identities.length!==3 || new Set(input.identities.map(i=>i.field)).size!==3 || input.identities.some(i=>! /^[a-f0-9]{64}$/.test(i.hash))))throw new Error('투표 정보를 확인해주세요.');
 const id=crypto.randomUUID(),guard=crypto.randomUUID(),now=Date.now(),window=Math.floor(now/300000),result={id,kind:input.kind};
 // Rate budget is consumed even for rejected requests. No raw IP is persisted.
 const rate=await q('INSERT INTO event_rate_limits VALUES(?,?,?,1) ON CONFLICT(event_id,subject_hmac,window) DO UPDATE SET count=count+1 RETURNING count',input.eventId,input.rateHmac,window).first<{count:number}>();
 if((rate?.count??99)>20)throw new Error('잠시 후 다시 시도해주세요.');
 const statements=[
  q('INSERT INTO event_operation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM events WHERE id=? AND revision=?) THEN 1 ELSE 0 END',guard,input.eventId,input.revision),
  input.kind==='submission'?q('INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(?,?,?,?,?,?)',input.eventId,id,input.stageId,input.round,message,now):q('INSERT INTO event_votes VALUES(?,?,?,?,?,?)',input.eventId,id,input.stageId,input.round,input.candidateId,now),
  q('INSERT INTO event_participants VALUES(?,?,?,?,?,?,?,?)',input.eventId,input.participantId,input.kind==='submission'?id:null,input.kind==='voting'?id:null,JSON.stringify(input.envelope),input.envelope.keyVersion,JSON.stringify(input.masked),now+(JSON.parse(stage.published_json).retentionDays??90)*86400000),
  ...[...new Set(input.policyIds)].map(policy=>q('INSERT INTO event_consents VALUES(?,?,?,?)',input.eventId,input.participantId,policy,now)),
  ...(input.kind==='voting'?input.identities.flatMap(identity=>[
   q('INSERT INTO event_vote_identities VALUES(?,?,?,?,?,?,?)',input.eventId,id,input.stageId,input.round,identity.field,identity.hash,input.identityKeyVersion),
   ...(!stage.allow_repeat?[q('INSERT INTO event_identity_claims VALUES(?,?,?,?,?,?)',input.eventId,input.stageId,input.round,identity.field,identity.hash,id)]:[])
  ]):[]),
  q('INSERT INTO event_requests VALUES(?,?,?,?,?,?,?)',input.eventId,input.stageId,input.round,input.requestKey,input.payloadHmac,JSON.stringify(result),now+86400000),
  q("INSERT INTO event_audit(id,event_id,action,target_id,created_at) VALUES(?,?,?,?,?)",crypto.randomUUID(),input.eventId,input.kind==='submission'?'entry.received':'vote.received',id,now),
  q('DELETE FROM event_operation_guards WHERE id=?',guard)
 ];
 try{await db.batch(statements);return result;}
 catch(error){const retry=await prior();if(retry)return restore(retry);throw new Error('참여를 완료하지 못했습니다. 이벤트 상태 또는 중복 참여 여부를 확인해주세요.');}
}
