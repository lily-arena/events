import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {saveField,getEditor} from '../../workers/data/src/admin/content.js';
import {loadPolicies} from '../../workers/data/src/campaign.js';
import type {DataEnv} from '../../workers/data/src/env.js';
import type {AdminIdentity} from '../../workers/data/src/admin/common.js';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
it('edits actual modal text as a new policy version, preserving old text and rejecting stale saves',async()=>{
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
 const body='이것은 첫 번째 개인정보 수집 이용 동의문 본문입니다.';
 const first=await saveField(env,admin,'first-seat',{page:'SUBMISSION',key:'privacy_body',text:body,expectedVersion:0,requestId:'test-1'});
 expect(first.fields.find(f=>f.key==='privacy_body')?.text).toBe(body);
 const old=(await loadPolicies(env,'campaign'))[0]!;
 const updated='이것은 수정된 개인정보 수집 이용 동의문 본문입니다.';
 await saveField(env,admin,'first-seat',{page:'SUBMISSION',key:'privacy_body',text:updated,expectedVersion:first.version,requestId:'test-2'});
 const active=(await loadPolicies(env,'campaign'))[0]!;
 expect(active.id).not.toBe(old.id);expect(active.body).toBe(updated);expect(active.version).toBe(2);
 expect(db.prepare('SELECT body FROM policy_documents WHERE id=?').get(old.id)?.body).toBe(body);
 await expect(saveField(env,admin,'first-seat',{page:'SUBMISSION',key:'privacy_body',text:body,expectedVersion:first.version,requestId:'stale'})).rejects.toThrow('다른 곳에서 먼저 저장');
 expect((await getEditor(env,admin,'first-seat','SUBMISSION')).fields.find(f=>f.key==='privacy_body')?.text).toBe(updated);
 const editor=await getEditor(env,admin,'first-seat','SUBMISSION');
 expect(editor.fields.find(f=>f.key==='pii_retention_days')?.text).toBe('180');
 const saved=await saveField(env,admin,'first-seat',{page:'SUBMISSION',key:'pii_retention_days',text:'45',expectedVersion:editor.version,requestId:'retention'});
 expect(saved.fields.find(f=>f.key==='pii_retention_days')?.text).toBe('45');
 await expect(saveField(env,admin,'first-seat',{page:'SUBMISSION',key:'pii_retention_days',text:'0',expectedVersion:saved.version,requestId:'bad-retention'})).rejects.toThrow('보유기간');
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
