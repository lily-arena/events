import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
/** Test-only D1 adapter. Every test uses an isolated in-memory SQLite database. */
export function memoryD1(schema: string) {
 const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
 function prepare(sql: string) {
  let args: unknown[] = [];
  const statement = {
   bind(...values: unknown[]) { args=values; return statement; },
   async first<T>() { return sqlite.prepare(sql).get(...args as never[]) as T ?? null; },
   async all() { return {success:true,results:sqlite.prepare(sql).all(...args as never[])}; },
   async run() { const result=sqlite.prepare(sql).run(...args as never[]); return {success:true,meta:{changes:Number(result.changes)}}; }
  }; return statement;
 }
 return { sqlite, db: { prepare, async batch(statements: {run:()=>Promise<unknown>}[]) {
  sqlite.exec('BEGIN');
  try { const results=[]; for(const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
  catch(error) {sqlite.exec('ROLLBACK');throw error;}
 }} as unknown as D1Database };
}
