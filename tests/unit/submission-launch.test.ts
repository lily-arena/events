import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { readFileSync } from 'node:fs';

describe('operator start agrees with submission database gate', () => {
  it('starting with the default zero flag allows submission; pause and stale revisions still block it', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE campaigns(id TEXT,state TEXT,paused INTEGER,launch_approved INTEGER DEFAULT 0,revision INTEGER,submission_start INTEGER,submission_end INTEGER,max_message_length INTEGER,updated_at INTEGER);
      CREATE TABLE submissions(campaign_id TEXT,config_revision INTEGER,grapheme_count INTEGER);
      INSERT INTO campaigns VALUES('c','SUBMISSION_OPEN',0,0,2,NULL,NULL,30,0);`);
    const migration=readFileSync('migrations/0004_open_ended_deadline.sql','utf8');
    db.exec(migration.slice(migration.indexOf('CREATE TRIGGER submission_gate'), migration.indexOf('DROP TRIGGER IF EXISTS vote_gate;')));
    const insert=()=>db.exec("INSERT INTO submissions VALUES('c',2,5)");
    expect(insert).toThrow('SUBMISSION_GATE');
    const source=readFileSync('workers/data/src/admin/actions.ts','utf8');
    const sql=source.match(/`(UPDATE campaigns SET [^`]*submission_start = \?[^`]*)`/)![1]!;
    const now=Date.now()-2000;
    db.prepare(sql).run(now,now,now,'c');
    expect(insert).not.toThrow();
    db.exec('UPDATE campaigns SET paused=1');
    expect(insert).toThrow('SUBMISSION_GATE');
    db.exec('UPDATE campaigns SET paused=0, revision=3');
    expect(insert).toThrow('SUBMISSION_GATE');
    db.close();
  });
});
