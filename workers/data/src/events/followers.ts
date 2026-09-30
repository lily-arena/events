import {sha256Hex} from '../../../../packages/security/src/hash';
const changed='팔로워 자료가 변경되었습니다. 새로 불러온 뒤 다시 시도해주세요.';
export class Followers {
 constructor(private db:D1Database,private actor:string){}
 private q(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args)}
 async metadata(event:string){return this.q("SELECT id,export_date,created_at,applied_at,(SELECT count(*) FROM event_follower_members m WHERE m.event_id=f.event_id AND m.import_id=f.id) AS count FROM event_follower_imports f WHERE event_id=? AND status='active'",event).first();}
 async begin(event:string,date:unknown,previous:unknown){
  if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('자료 날짜를 확인해주세요.');
  const active=await this.metadata(event);if((active?.id??null)!==previous)throw new Error(changed);
  const stage=await this.q("SELECT id,round FROM event_stages WHERE event_id=? AND kind='voting'",event).first<{id:string;round:number}>();if(!stage)throw new Error('투표 단계를 추가해주세요.');
  const id=crypto.randomUUID();await this.q("DELETE FROM event_follower_imports WHERE event_id=? AND status<>'active' AND created_at<?",event,Date.now()-86400000).run();
  await this.q("INSERT INTO event_follower_imports VALUES(?,?,?,?,?,?,'uploading',?,?,NULL)",event,id,this.actor,stage.id,stage.round,previous,date,Date.now()).run();return {id,stageId:stage.id,round:stage.round};
 }
 async context(event:string,id:string){const row=await this.q("SELECT * FROM event_follower_imports WHERE event_id=? AND id=? AND admin_id=? AND status='uploading' AND created_at>?",event,id,this.actor,Date.now()-3600000).first<{id:string;stage_id:string;round:number;previous_id:string|null}>();if(!row)throw new Error('자료 업로드가 만료되었습니다. 다시 업로드해주세요.');return row;}
 async chunk(event:string,id:string,position:number,hashes:string[]){
  await this.context(event,id);
  if(!Number.isInteger(position)||position<0||position>=200||!Array.isArray(hashes)||hashes.length<1||hashes.length>500||hashes.some(h=>! /^[a-f0-9]{64}$/.test(h)))throw new Error('팔로워 자료 크기나 형식을 확인해주세요.');
  const digest=await sha256Hex(JSON.stringify(hashes)),guard=crypto.randomUUID();
  await this.db.batch([
   this.q("INSERT INTO event_operation_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM event_follower_imports WHERE event_id=? AND id=? AND admin_id=? AND status='uploading') AND NOT EXISTS(SELECT 1 FROM event_follower_chunks WHERE event_id=? AND import_id=? AND position=? AND digest<>?) THEN 1 ELSE 0 END",guard,event,id,this.actor,event,id,position,digest),
   this.q('INSERT OR IGNORE INTO event_follower_chunks VALUES(?,?,?,?)',event,id,position,digest),
   this.q('INSERT OR IGNORE INTO event_follower_members SELECT ?,?,value FROM json_each(?)',event,id,JSON.stringify(hashes)),
   this.q('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);
 }
 async apply(event:string,id:string,chunks:number,count:number){
  const row=await this.context(event,id);if(!Number.isInteger(chunks)||chunks<0||chunks>200||!Number.isInteger(count)||count<0||count>100000)throw new Error('팔로워 자료 크기나 형식을 확인해주세요.');
  const guard=crypto.randomUUID();
  try{await this.db.batch([
   this.q("INSERT INTO event_operation_guards SELECT ?,CASE WHEN (SELECT id FROM event_follower_imports WHERE event_id=? AND status='active') IS ? AND EXISTS(SELECT 1 FROM event_follower_imports WHERE event_id=? AND id=? AND status='uploading') AND EXISTS(SELECT 1 FROM event_stages WHERE event_id=? AND id=? AND round=?) AND (SELECT count(*) FROM event_follower_chunks WHERE event_id=? AND import_id=?)=? AND NOT EXISTS(SELECT 1 FROM event_follower_chunks WHERE event_id=? AND import_id=? AND position>=?) AND (SELECT count(*) FROM event_follower_members WHERE event_id=? AND import_id=?)=? THEN 1 ELSE 0 END",guard,event,row.previous_id,event,id,event,row.stage_id,row.round,event,id,chunks,event,id,chunks,event,id,count),
   this.q("UPDATE event_follower_imports SET status='obsolete' WHERE event_id=? AND status='active'",event),
   this.q("UPDATE event_follower_imports SET status='active',applied_at=? WHERE event_id=? AND id=?",Date.now(),event,id),
   this.q("DELETE FROM event_follower_imports WHERE event_id=? AND status='obsolete'",event),
   this.q("INSERT INTO event_audit(id,event_id,admin_id,action,metadata_json,created_at) VALUES(?,?,?,'followers.applied',?,?)",crypto.randomUUID(),event,this.actor,JSON.stringify({importId:id,count}),Date.now()),
   this.q('DELETE FROM event_operation_guards WHERE id=?',guard)
  ]);}catch{throw new Error(changed)}return this.metadata(event);
 }
}
// A live lookup automatically covers both existing and subsequently accepted votes.
export const followJoins=` LEFT JOIN event_follower_imports fi ON fi.event_id=p.event_id AND fi.status='active'
 LEFT JOIN event_vote_identities vi ON vi.event_id=p.event_id AND vi.vote_id=p.vote_id AND vi.field='instagram'
 LEFT JOIN event_follower_members fm ON fm.event_id=fi.event_id AND fm.import_id=fi.id AND fm.identity_hmac=vi.identity_hmac `;
export const followStatus="CASE WHEN fi.id IS NULL OR vi.identity_hmac IS NULL THEN 'unknown' WHEN fm.identity_hmac IS NOT NULL THEN 'following' ELSE 'not_following' END";
