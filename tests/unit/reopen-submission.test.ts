import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {previewAction,executeAction} from '../../workers/data/src/admin/actions.js';
import type {DataEnv} from '../../workers/data/src/env.js';
import type {AdminIdentity} from '../../workers/data/src/admin/common.js';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
it('reopens submission atomically and makes retries idempotent',async()=>{
 const db=new DatabaseSync(':memory:');
 try {
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(`migrations/${file}`,'utf8'));
 const now=Date.now();
 db.prepare("INSERT INTO administrators VALUES ('editor','test:editor','test@example.com',1,?)").run(now);
 db.prepare("INSERT INTO campaigns(id,slug,created_at,updated_at) VALUES('campaign','first-seat',?,?)").run(now,now);
 function prepare(sql:string){
  let args:unknown[]=[];
  return {bind(...values:unknown[]){args=values;return this;},
   first(){return db.prepare(sql).get(...args as never[])??null;},
   all(){return {results:db.prepare(sql).all(...args as never[])};},
   run(){db.prepare(sql).run(...args as never[]);return {success:true};}};
 }
 const env={DB:{prepare,batch:async(statements:ReturnType<typeof prepare>[])=>{
  db.exec('BEGIN');try{const result=statements.map(s=>s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
 }}} as unknown as DataEnv;
 const admin={id:'editor',email:'test@example.com',roles:['OPERATOR']} as unknown as AdminIdentity;

 db.prepare("UPDATE campaigns SET state='RESULT_PUBLISHED', paused=1, submission_end=1 WHERE id='campaign'").run();
 const preview=await previewAction(env,admin,'first-seat','OPEN_SUBMISSION');
 expect(preview.allowed).toBe(true);
 const result=await executeAction(env,admin,'first-seat','OPEN_SUBMISSION','test-reopen',preview.expectedRevision,preview.snapshotDigest,'test');
 expect(result.state).toBe('SUBMISSION_OPEN');
 expect(db.prepare("SELECT state, paused, submission_end, launch_approved FROM campaigns").get()).toMatchObject({state:'SUBMISSION_OPEN',paused:0,submission_end:null,launch_approved:1});
 expect(db.prepare('SELECT COUNT(*) AS n FROM transition_events').get()?.n).toBe(1);
 const retry=await executeAction(env,admin,'first-seat','OPEN_SUBMISSION','test-reopen',preview.expectedRevision,preview.snapshotDigest,'retry');
 expect(retry).toEqual(result);
 expect(db.prepare('SELECT COUNT(*) AS n FROM transition_events').get()?.n).toBe(1);
 expect((await previewAction(env,admin,'first-seat','OPEN_SUBMISSION')).allowed).toBe(false);
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
