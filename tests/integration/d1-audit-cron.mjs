#!/usr/bin/env node
// Isolated real Workers/D1 runtime, production branch, no R2. Never touches the user's local/remote DB.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const state = mkdtempSync(join(tmpdir(), 'first-seat-d1-cron-'));
const config = 'workers/data/wrangler.jsonc';
let child;
let logs = '';
function d1(args) {
  const r = spawnSync(wrangler, ['d1','execute','first-seat','--local','--config',config,'--persist-to',state,'--yes',...args], { cwd: root, encoding:'utf8' });
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function query(sql) { return JSON.parse(d1(['--json','--command',sql]))[0].results; }
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
try {
  for (const f of readdirSync(resolve(root,'migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    d1(['--file',`migrations/${f}`]);
  }
  const now = Date.now();
  const gate = query("SELECT sql FROM sqlite_master WHERE name='submission_gate'")[0].sql;
  const seed = join(state,'fixture.sql');
  writeFileSync(seed, `
    INSERT INTO administrators VALUES ('test-admin','test-only','test@example.com',1,${now});
    INSERT INTO campaigns(id,slug,created_at,updated_at) VALUES ('test-campaign','first-seat',${now},${now});
    INSERT INTO campaign_revisions(campaign_id,revision,config_json,digest,actor_id,created_at)
      VALUES ('test-campaign',1,'{}','test','test-admin',${now});
    DROP TRIGGER submission_gate;
    INSERT INTO submissions(id,campaign_id,config_revision,message,grapheme_count,accepted_at)
      VALUES ('test-submission','test-campaign',1,'테스트 문구',6,${now});
    ${gate};
    INSERT INTO pii_contacts(submission_id,ciphertext,wrapped_dek,iv,key_version,masked_name,masked_phone,masked_email,retention_until,created_at)
      VALUES ('test-submission',x'01',x'02',zeroblob(12),'test','가상','가상','가상',${now-1000},${now});
    INSERT INTO deletion_jobs(id,campaign_id,target_id,kind,due_at,reason,updated_at)
      VALUES ('test-job','test-campaign','test-submission','CONTACT',${now-1000},'test only',${now});
    INSERT INTO audit_events(id,action,target_type,occurred_at,outcome,request_id,retention_until)
      VALUES ('test-audit','TEST','test',${now},'SUCCESS','test',${now+31536000000});
    INSERT INTO audit_outbox(event_id,r2_key,storage_backend) VALUES ('test-audit','d1://audit_events/test-audit','D1');
  `);
  d1(['--file',seed]);
  const server = createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  await new Promise(resolve=>server.close(resolve));
  child = spawn(wrangler,['dev','--local','--config',config,'--persist-to',state,'--port',String(port),'--test-scheduled',
    '--var','ENVIRONMENT:production','--var','AUDIT_SIGNING_SECRET:isolated-test-key'], { cwd:root, stdio:['ignore','pipe','pipe'] });
  child.stdout.on('data',b=>{logs+=b;}); child.stderr.on('data',b=>{logs+=b;});
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i=0;i<60;i++) {
    if (child.exitCode !== null) throw new Error('Worker exited before readiness');
    try { await fetch(base); ready=true; break; } catch { await delay(500); }
  }
  assert.ok(ready,'Worker ready');
  for(let i=0;i<2;i++) {
    const response = await fetch(`${base}/__scheduled?cron=${encodeURIComponent('*/5 * * * *')}`);
    assert.equal(response.status,200,await response.text());
  }
  assert.equal(query('SELECT COUNT(*) n FROM pii_contacts')[0].n,0);
  assert.equal(query('SELECT COUNT(*) n FROM submissions')[0].n,1);
  assert.equal(query('SELECT state FROM deletion_jobs')[0].state,'VERIFIED');
  assert.equal(query("SELECT COUNT(*) n FROM deletion_ledger WHERE storage_backend='D1' AND length(digest)=64 AND r2_key IS NULL AND archived_at IS NULL")[0].n,2);
  assert.equal(query('SELECT COUNT(*) n FROM audit_outbox WHERE delivered_at IS NULL')[0].n,0);
  assert.equal(query("SELECT COUNT(*) n FROM audit_outbox WHERE storage_backend='D1' AND length(digest)=64")[0].n,2);
  assert.deepEqual(query('PRAGMA foreign_key_check'),[]);
  console.log('PASS: production-mode Cron on isolated Workers/D1, no R2: signed audit, atomic contact deletion, signed intent/complete, repeat run, FK integrity.');
} catch(e) {
  console.error(logs.slice(-5000)); throw e;
} finally {
  if(child && child.exitCode===null) {
    const stopped = new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM');
    await Promise.race([stopped,delay(5000)]);
    if(child.exitCode===null) child.kill('SIGKILL');
  }
  rmSync(state,{recursive:true,force:true});
}
