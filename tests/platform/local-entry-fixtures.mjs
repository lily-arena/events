import {execFileSync} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
// Only the isolated local D1 is reachable from this fixture helper.
export function seedEntries(eventId,messages){
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 const entries=messages.map((message,index)=>({id:crypto.randomUUID(),message,created_at:Date.now()+index}));
 const file='artifacts/platform/review-fixture.sql';
 writeFileSync(file,`UPDATE events SET visibility='published',current_stage_id='submission' WHERE id=${quote(eventId)}; UPDATE event_stages SET accepting=1 WHERE event_id=${quote(eventId)} AND id='submission';\n`+entries.map(e=>`INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(${quote(eventId)},${quote(e.id)},'submission',1,${quote(e.message)},${e.created_at});`).join('\n'));
 try{execFileSync('npx',['wrangler','d1','execute','seoularena-events-local','--local','--config','workers/data/wrangler.events.jsonc','--persist-to','.wrangler-events','--file',file],{stdio:'pipe'});}finally{unlinkSync(file);}
 return entries;
}
