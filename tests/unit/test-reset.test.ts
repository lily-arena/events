import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resetTestData} from '../../workers/data/src/admin/reset.js';
import {issueVoterSession} from '../../workers/data/src/votes.js';
import type {DataEnv} from '../../workers/data/src/env.js';
import type {AdminIdentity} from '../../workers/data/src/admin/common.js';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

it('deletes only campaign test data, preserves settings/audit, rolls back failures and supports same-browser retesting',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
 for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.exec("INSERT INTO administrators VALUES('admin','test:admin','test@example.com',1,0),('checker','test:checker','check@example.com',1,0)");
 db.exec("INSERT INTO approvals VALUES('approval','test','digest','admin','checker',0,9999999999999)");
 for(const id of ['test','other']){
 const run=(s:string)=>db.exec(s.replaceAll('$',id));
 run("INSERT INTO campaigns(id,slug,state,launch_approved,voting_epoch,created_at,updated_at) VALUES('$','$','SUBMISSION_OPEN',1,1,0,0)");
 run("INSERT INTO campaign_revisions(campaign_id,revision,config_json,digest,actor_id,created_at) VALUES('$',1,'{}','d','admin',0)");
 run("INSERT INTO submissions(id,campaign_id,config_revision,message,grapheme_count,accepted_at) VALUES('$s','$',1,'테스트',3,0)");
 run("INSERT INTO pii_contacts VALUES('$s',X'01',X'01',zeroblob(12),'test',1,'가상','가상','가상',9999999999999,NULL,0)");
 run("INSERT INTO policy_documents(id,campaign_id,kind,version,body,digest,created_at) VALUES('$p','$','PRIVACY',1,'동의문','d',0)");
 run("INSERT INTO campaign_policies VALUES('$','PRIVACY','$p',1)");
 run("INSERT INTO consent_receipts VALUES('$s','$p',0)");
 run("INSERT INTO candidate_sets(id,campaign_id,epoch,status,rules_json,created_by) VALUES('$set','$',1,'FROZEN','{}','admin')");
 run("INSERT INTO candidates(id,set_id,campaign_id,epoch,source_submission_id,public_message,public_number,display_order) VALUES('$c','$set','$',1,'$s','테스트',1,0)");
 run("INSERT INTO anonymous_sessions VALUES('$a','$','VOTER',1,'$token',0,9999999999999)");
 run("INSERT INTO session_policy_receipts VALUES('$a','$p',0)");
 run("UPDATE campaigns SET state='VOTING_OPEN' WHERE id='$'");
 run("INSERT INTO votes(id,campaign_id,epoch,set_id,candidate_id,voter_session_id,accepted_at,initial_review_state) VALUES('$v','$',1,'$set','$c','$a',0,'INCLUDED')");
 run("INSERT INTO vote_risk_signals VALUES('$v','h','test','test','[]',9999999999999)");
 run("INSERT INTO vote_decisions VALUES('$d','$v',1,'INCLUDED','test','admin','approval',0)");
 run("INSERT INTO jury_scores VALUES('$set','$c','admin',1,'{}',1,0)");
 run("INSERT INTO result_versions(id,campaign_id,epoch,version,set_id,winner_candidate_id,maker_id,created_at) VALUES('$r','$',1,1,'$set','$c','admin',0)");
 run("INSERT INTO result_media VALUES('$m','$r','test','test','test',0,'admin')");
 run("INSERT INTO idempotency_records VALUES('vote','$token','key','h','$v',201,0,9999999999999)");
 run("UPDATE campaigns SET state='RESULT_PUBLISHED' WHERE id='$'");
 }
 function prepare(sql:string){
 let args:unknown[]=[];
 return {bind(...v:unknown[]){args=v;return this;},first(){return db.prepare(sql).get(...args as never[])??null;},all(){return {results:db.prepare(sql).all(...args as never[])};},run(){db.prepare(sql).run(...args as never[]);return {success:true};}};
 }
 const env={DB:{prepare,batch:async(ss:ReturnType<typeof prepare>[])=>{
 db.exec('BEGIN');try{const r=ss.map(s=>s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}
 }}} as unknown as DataEnv;
 const admin={id:'admin',email:'test@example.com',roles:['OPERATOR']} as AdminIdentity;
 const key=crypto.randomUUID(),call=()=>resetTestData(env,admin,'test',1,key,'DELETE_TEST_DATA_AND_REOPEN','test');
 await expect(resetTestData(env,admin,'test',1,key,'','test')).rejects.toThrow();
 await expect(resetTestData(env,admin,'test',99,key,'DELETE_TEST_DATA_AND_REOPEN','test')).rejects.toThrow();
 expect(()=>db.exec("DELETE FROM vote_decisions WHERE id='testd'")).toThrow('DECISION_IMMUTABLE');
 db.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON votes BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END");
 await expect(call()).rejects.toThrow('TEST_FAILURE');
 expect(db.prepare("SELECT COUNT(*) AS n FROM result_versions").get()?.n).toBe(2);
 expect(db.prepare("SELECT COUNT(*) AS n FROM campaign_reset_runs").get()?.n).toBe(0);
 db.exec('DROP TRIGGER fail_reset');
 expect(await call()).toEqual({revision:2});
 expect(await call()).toEqual({revision:2});
 for(const t of ['submissions','pii_contacts','consent_receipts','candidate_sets','candidates','votes','vote_risk_signals','vote_decisions','jury_scores','result_versions','result_media','anonymous_sessions','session_policy_receipts','idempotency_records']){
 expect(db.prepare('SELECT COUNT(*) AS n FROM '+t).get()?.n,t).toBe(1);
 }
 expect(db.prepare('SELECT COUNT(*) AS n FROM policy_documents').get()?.n).toBe(2);
 expect(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='TEST_DATA_RESET'").get()?.n).toBe(1);
 expect(db.prepare("SELECT state,voting_epoch FROM campaigns WHERE id='test'").get()).toMatchObject({state:'SUBMISSION_OPEN',voting_epoch:2});
 // The original token can obtain a fresh session once voting opens again.
 db.exec("UPDATE campaigns SET state='VOTING_OPEN' WHERE id='test'");
 expect((await issueVoterSession(env,{campaignSlug:'test',tokenHash:'testtoken',rateSubjectHmac:'test-ip'})).epoch).toBe(2);
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
