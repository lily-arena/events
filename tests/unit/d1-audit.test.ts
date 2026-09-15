import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { readFileSync, readdirSync } from 'node:fs';
import { canonicalJson, hmacSha256Hex } from '@first-seat/security';
import { auditStatements } from '../../workers/data/src/admin/common.js';
import { enqueueExpiredContacts, runDeletionJobs } from '../../workers/data/src/admin/deletion.js';
import { cleanupExpired, deliverAuditOutbox, runScheduled } from '../../workers/data/src/jobs.js';
import type { DataEnv } from '../../workers/data/src/env.js';

// Real SQLite constraints/triggers with D1's documented atomic batch semantics.
// Fault injection occurs inside the transaction, after earlier statements executed.
const databases: SQLiteDatabase[] = [];
function fixture(beforeUpgrade?: (db: SQLiteDatabase) => void) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
    if (file.startsWith('0005')) beforeUpgrade?.(db);
    db.exec('BEGIN');
    try { db.exec(readFileSync(`migrations/${file}`, 'utf8')); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.exec('PRAGMA foreign_keys=ON');
  let failOnce: string | null = null;
  let queryCount = 0;
  class Statement {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) { this.values = values; return this; }
    execute() {
      queryCount += 1;
      if (failOnce && this.sql.includes(failOnce)) { failOnce = null; throw new Error('injected DB failure'); }
      const result = db.prepare(this.sql).run(...this.values as never[]);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    }
    async run() { return this.execute(); }
    async first() { queryCount += 1; return db.prepare(this.sql).get(...this.values as never[]) ?? null; }
    async all() { queryCount += 1; return { results: db.prepare(this.sql).all(...this.values as never[]), success: true }; }
  }
  const env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        db.exec('BEGIN');
        try { const result = statements.map(s => s.execute()); db.exec('COMMIT'); return result; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      },
    } as unknown as D1Database,
    ENVIRONMENT: 'production', AUDIT_SIGNING_SECRET: 'test-audit-signing-key-not-production',
  } satisfies DataEnv;
  return { db, env, fail: (sql: string) => { failOnce = sql; }, queries: () => queryCount, resetQueries: () => { queryCount = 0; } };
}
afterEach(() => { databases.splice(0).forEach(db => db.close()); });

function seedContact(db: SQLiteDatabase, kind = 'CONTACT') {
  const now = Date.now();
  db.exec(`INSERT INTO administrators VALUES ('admin','test','test@example.com',1,${now});
    INSERT INTO campaigns(id,slug,created_at,updated_at) VALUES ('campaign','first-seat',${now},${now});
    INSERT INTO campaign_revisions(campaign_id,revision,config_json,digest,actor_id,created_at)
      VALUES ('campaign',1,'{}','fixture','admin',${now});`);
  // Seed a previously accepted submission. Production gate remains intact after setup.
  const gate = db.prepare("SELECT sql FROM sqlite_master WHERE name='submission_gate'").get() as { sql: string };
  db.exec('DROP TRIGGER submission_gate');
  db.exec(`INSERT INTO submissions(id,campaign_id,config_revision,message,grapheme_count,accepted_at)
      VALUES ('submission','campaign',1,'남아야 할 문구',8,${now});`);
  db.exec(gate.sql);
  db.exec(`INSERT INTO pii_contacts(submission_id,ciphertext,wrapped_dek,iv,key_version,masked_name,masked_phone,masked_email,retention_until,created_at)
    VALUES ('submission',x'01',x'02',zeroblob(12),'test','홍*동','010****1234','t***@example.com',${now-1000},${now});
    INSERT INTO deletion_jobs(id,campaign_id,target_id,kind,due_at,reason,updated_at)
    VALUES ('job','campaign','submission','${kind}',${now-1000},'test fixture',${now});`);
}
function count(db: SQLiteDatabase, table: string) { return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; }
async function event(env: DataEnv, now = Date.now()) {
  await env.DB.batch(auditStatements(env, {
    actorId: null, action: 'TEST', targetType: 'test', targetId: null,
    outcome: 'SUCCESS', requestId: crypto.randomUUID(),
  }, now));
}

describe('D1-only audit and deletion (production env, no R2 binding)', () => {
  it('preserves legacy audit data on populated 0004 → 0005 upgrade and seals its pending record', async () => {
    const { db, env } = fixture(db => { seedContact(db); db.exec(`
      INSERT INTO audit_events(id,action,target_type,occurred_at,outcome,request_id,retention_until)
        VALUES ('legacy','TEST','test',1,'SUCCESS','old',9999999999999);
      INSERT INTO audit_outbox(event_id,r2_key) VALUES ('legacy','old/path.json');`); });
    expect(count(db, 'pii_contacts')).toBe(1);
    expect(count(db, 'submissions')).toBe(1);
    expect(count(db, 'deletion_jobs')).toBe(1);
    expect(count(db, 'audit_events')).toBe(1);
    expect(db.prepare('SELECT r2_key,storage_backend FROM audit_outbox').get()).toMatchObject({ r2_key: 'old/path.json', storage_backend: 'LEGACY' });
    expect(await deliverAuditOutbox(env)).toEqual({ delivered: 1, failed: 0, pending: 0 });
    expect(db.prepare('SELECT storage_backend FROM audit_outbox').get()).toMatchObject({ storage_backend: 'D1' });
  });

  it('seals once, verifies HMAC, blocks edits and premature deletion', async () => {
    const { db, env } = fixture();
    const now = Date.now();
    await event(env, now);
    expect(() => db.exec('DELETE FROM audit_events')).toThrow('AUDIT_RETENTION');
    expect(await deliverAuditOutbox(env)).toEqual({ delivered: 1, failed: 0, pending: 0 });
    const row = db.prepare('SELECT * FROM audit_events').get()!;
    const digest = await hmacSha256Hex(env.AUDIT_SIGNING_SECRET, canonicalJson({
      id: row.id, actorId: null, action: 'TEST', targetType: 'test', targetId: null,
      occurredAt: now, outcome: 'SUCCESS', reason: null, requestId: row.request_id,
      metadata: {}, retentionUntil: row.retention_until,
    }));
    expect(db.prepare('SELECT digest FROM audit_outbox').get()).toMatchObject({ digest });
    expect(await deliverAuditOutbox(env)).toEqual({ delivered: 0, failed: 0, pending: 0 });
    expect(() => db.exec("UPDATE audit_events SET action='altered'")).toThrow();
    expect(() => db.exec("UPDATE audit_outbox SET digest='" + '0'.repeat(64) + "'")).toThrow('AUDIT_SEAL_IMMUTABLE');
    expect(() => db.exec('DELETE FROM audit_outbox')).toThrow('AUDIT_SEAL_REQUIRED');
  });

  it('retries failed sealing without losing the event', async () => {
    const { db, env, fail } = fixture();
    await event(env);
    fail('UPDATE audit_outbox SET delivered_at');
    expect(await deliverAuditOutbox(env)).toEqual({ delivered: 0, failed: 1, pending: 1 });
    expect(count(db, 'audit_events')).toBe(1);
    expect(await deliverAuditOutbox(env)).toEqual({ delivered: 1, failed: 0, pending: 0 });
  });

  it('deletes contact and masks atomically, keeps submission, signs both records, is idempotent', async () => {
    const { db, env } = fixture(); seedContact(db);
    expect(await runDeletionJobs(env)).toEqual({ processed: 1, verified: 1, failed: 0 });
    expect(count(db, 'pii_contacts')).toBe(0);
    expect(count(db, 'submissions')).toBe(1);
    const ledger = db.prepare('SELECT * FROM deletion_ledger ORDER BY event').all();
    expect(ledger).toHaveLength(2);
    for (const row of ledger) {
      expect(row.storage_backend).toBe('D1'); expect(row.r2_key).toBeNull(); expect(row.archived_at).toBeNull();
      expect(row.digest).toBe(await hmacSha256Hex(env.AUDIT_SIGNING_SECRET, String(row.payload_json)));
      expect(String(row.payload_json)).not.toContain('example.com');
    }
    expect(() => db.exec("UPDATE deletion_ledger SET event='changed'")).toThrow('LEDGER_IMMUTABLE');
    expect(() => db.exec('DELETE FROM deletion_ledger')).toThrow('LEDGER_RETENTION');
    expect(await runDeletionJobs(env)).toEqual({ processed: 0, verified: 0, failed: 0 });
    expect(count(db, 'deletion_ledger')).toBe(2);
    expect(count(db, 'audit_events')).toBe(1);
    expect(count(db, 'operation_guards')).toBe(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rolls back actual deletion when completion writing fails, then retries exactly once', async () => {
    const { db, env, fail } = fixture(); seedContact(db);
    fail("UPDATE deletion_jobs SET state='VERIFIED'");
    expect(await runDeletionJobs(env)).toEqual({ processed: 1, verified: 0, failed: 1 });
    expect(count(db, 'pii_contacts')).toBe(1);
    expect(count(db, 'deletion_ledger')).toBe(0);
    expect(count(db, 'audit_events')).toBe(0);
    expect(db.prepare('SELECT state,attempts,lease_token FROM deletion_jobs').get()).toMatchObject({ state: 'FAILED', attempts: 1, lease_token: null });
    expect(await runDeletionJobs(env)).toEqual({ processed: 1, verified: 1, failed: 0 });
  });

  it('skips a held lease and recovers an expired lease after process interruption', async () => {
    const { db, env } = fixture(); seedContact(db);
    db.prepare('UPDATE deletion_jobs SET lease_token=?,lease_until=?').run('other-run', Date.now() + 60000);
    expect((await runDeletionJobs(env)).processed).toBe(0);
    db.exec('UPDATE deletion_jobs SET lease_until=1');
    expect((await runDeletionJobs(env)).verified).toBe(1);
  });

  it('prevents two simultaneous runners from completing the same job twice', async () => {
    const { db, env } = fixture(); seedContact(db);
    const runs = await Promise.all([runDeletionJobs(env), runDeletionJobs(env)]);
    expect(runs.reduce((n, r) => n + r.verified, 0)).toBe(1);
    expect(count(db, 'deletion_ledger')).toBe(2);
    expect(count(db, 'audit_events')).toBe(1);
  });

  it('rejects a corrupt signed intent without deleting the target', async () => {
    const { db, env } = fixture(); seedContact(db);
    db.prepare(`INSERT INTO deletion_ledger(id,job_id,event,occurred_at,restore_residue_until,storage_backend,payload_json,digest,retention_until)
      VALUES ('corrupt','job','INTENT',1,2,'D1','{}',?,9999999999999)`).run('0'.repeat(64));
    expect((await runDeletionJobs(env)).failed).toBe(1);
    expect(count(db, 'pii_contacts')).toBe(1);
  });

  it('fully removes a submission with a reveal grant while keeping audit history', async () => {
    const { db, env } = fixture(); seedContact(db, 'SUBMISSION');
    db.exec(`INSERT INTO admin_sessions(id,admin_id,session_hash,created_at,last_seen_at,expires_at) VALUES ('session','admin','hash',1,1,9999999999999);
      INSERT INTO reveal_grants(id,admin_session_id,submission_id,nonce_hash,reason,created_at,expires_at)
      VALUES ('grant','session','submission','nonce','test',1,9999999999999);`);
    await event(env);
    expect((await runDeletionJobs(env)).verified).toBe(1);
    expect(count(db, 'submissions')).toBe(0); expect(count(db, 'reveal_grants')).toBe(0);
    expect(count(db, 'audit_events')).toBe(2);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('deletes expired sealed audit and its seal together without foreign key failure', async () => {
    const { db, env } = fixture(); seedContact(db, 'AUDIT');
    await event(env, Date.now() - 366 * 86400000);
    const audit = db.prepare('SELECT id FROM audit_events').get()!;
    db.prepare('UPDATE deletion_jobs SET target_id=?').run(audit.id);
    expect((await runDeletionJobs(env)).failed).toBe(1); // not sealed yet
    await deliverAuditOutbox(env);
    expect((await runDeletionJobs(env)).verified).toBe(1);
    expect(db.prepare('SELECT id FROM audit_events WHERE id=?').get(audit.id)).toBeUndefined();
    expect(db.prepare('SELECT event_id FROM audit_outbox WHERE event_id=?').get(audit.id)).toBeUndefined();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('deduplicates expiry queue creation and preserves active retained ledger during cleanup', async () => {
    const { db, env } = fixture(); seedContact(db);
    db.exec('DELETE FROM deletion_jobs');
    const created = await Promise.all([enqueueExpiredContacts(env), enqueueExpiredContacts(env)]);
    expect(created.reduce((a,b) => a+b, 0)).toBe(1);
    await runDeletionJobs(env);
    await cleanupExpired(env);
    expect(count(db, 'deletion_ledger')).toBe(2);
  });
  it('makes progress under the Free-plan query budget with a full audit and deletion backlog', async () => {
    const { db, env, queries, resetQueries } = fixture(); seedContact(db);
    const gate = db.prepare("SELECT sql FROM sqlite_master WHERE name='submission_gate'").get() as { sql: string };
    db.exec('DROP TRIGGER submission_gate');
    const original = db.prepare('SELECT * FROM submissions').get()!;
    const pii = db.prepare('SELECT * FROM pii_contacts').get()!;
    for (let i=0; i<30; i++) {
      const submission = { ...original, id: `sub-${i}` };
      const contact = { ...pii, submission_id: `sub-${i}` };
      for (const [table, row] of [['submissions',submission],['pii_contacts',contact]] as const) {
        db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row) as never[]);
      }
    }
    db.exec(gate.sql);
    for (let i=0; i<30; i++) await event(env);
    resetQueries();
    const result = await runScheduled(env);
    expect(result.outbox.delivered).toBe(20);
    expect(result.enqueued).toBe(20);
    expect(result.deletion.verified).toBe(2);
    expect(queries()).toBeLessThanOrEqual(48); // Leave two statements for authenticated Admin RPC.
    expect(count(db, 'pii_contacts')).toBe(29);
  });

  it('lets other jobs progress after permanently failing jobs consume one run budget', async () => {
    const { db, env } = fixture(); seedContact(db);
    const now=Date.now();
    db.prepare('UPDATE deletion_jobs SET updated_at=?').run(now-3000);
    for(const [id,when] of [['bad2',now-2000],['good',now-1000]] as const) {
      db.prepare(`INSERT INTO deletion_jobs(id,campaign_id,target_id,kind,due_at,reason,updated_at)
        VALUES (?,'campaign',?,'CONTACT',?,'test',?)`).run(id,id,now-4000,when);
    }
    for(const job of ['job','bad2']) {
      db.prepare(`INSERT INTO deletion_ledger(id,job_id,event,occurred_at,restore_residue_until,storage_backend,payload_json,digest,retention_until)
        VALUES (?,?,'INTENT',1,2,'D1','{}',?,9999999999999)`).run('corrupt-'+job,job,'0'.repeat(64));
    }
    expect((await runDeletionJobs(env)).failed).toBe(2);
    expect((await runDeletionJobs(env)).verified).toBe(1);
    expect(db.prepare("SELECT state FROM deletion_jobs WHERE id='good'").get()).toMatchObject({state:'VERIFIED'});
    expect(count(db,'pii_contacts')).toBe(1);
  });

});
