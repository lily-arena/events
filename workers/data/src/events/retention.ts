/** Expired contact data is removed in bounded atomic batches. Audit records remain. */
export async function purgeExpired(db:D1Database,now=Date.now()) {
 const q=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
 const expired=(await q('SELECT event_id,id FROM event_participants WHERE retention_until<=? ORDER BY retention_until LIMIT 100',now).all<{event_id:string;id:string}>()).results;
 for(const {event_id:id,id:participantId} of expired){
  await db.batch([
   q('DELETE FROM event_consents WHERE event_id=? AND participant_id=?',id,participantId),
   q('DELETE FROM event_identity_claims WHERE event_id=? AND vote_id=(SELECT vote_id FROM event_participants WHERE event_id=? AND id=?)',id,id,participantId),
   q('DELETE FROM event_vote_identities WHERE event_id=? AND vote_id=(SELECT vote_id FROM event_participants WHERE event_id=? AND id=?)',id,id,participantId),
   q('DELETE FROM event_participants WHERE event_id=? AND id=? AND retention_until<=?',id,participantId,now),
   q('INSERT OR IGNORE INTO event_identity_claims SELECT event_id,stage_id,round,field,identity_hmac,min(vote_id) FROM event_vote_identities WHERE event_id=? GROUP BY event_id,stage_id,round,field,identity_hmac',id),
   q("INSERT INTO event_audit(id,event_id,action,target_id,created_at) VALUES(?,?,'privacy.expired',?,?)",crypto.randomUUID(),id,participantId,now)
  ]);
 }
 await db.batch([q('DELETE FROM event_requests WHERE expires_at<=?',now),q('DELETE FROM event_reset_tokens WHERE expires_at<=?',now),q('DELETE FROM event_rate_limits WHERE window<?',Math.floor(now/300000)-12)]);
 return expired.length;
}
