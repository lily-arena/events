#!/usr/bin/env python3
"""Restore a P011 SQL backup into a NEW local SQLite DB and verify without printing rows."""
import base64,hashlib,json,pathlib,sqlite3,sys

def digest(db, table):
    rows=[]
    for row in db.execute('SELECT * FROM "'+table.replace('"','""')+'"'):
        normalized=[{'blob_base64':base64.b64encode(v).decode()} if isinstance(v,bytes) else v for v in row]
        rows.append(json.dumps(normalized,ensure_ascii=False,separators=(',',':')))
    return hashlib.sha256(('\n'.join(sorted(rows))+'\n').encode()).hexdigest()

def verify(db, inventory):
    results={}
    for table,expected in inventory['tables'].items():
        count=db.execute('SELECT count(*) FROM "'+table.replace('"','""')+'"').fetchone()[0]
        results[table]={'count':count,'count_matches':count==expected,'data_sha256':digest(db,table)}
        results[table]['data_matches']=results[table]['data_sha256']==inventory['table_data_sha256'][table]
    integrity=db.execute('PRAGMA integrity_check').fetchall()
    fk=len(db.execute('PRAGMA foreign_key_check').fetchall())
    return {'passed':integrity==[('ok',)] and fk==0 and all(r['count_matches'] and r['data_matches'] for r in results.values()),'integrity_check':integrity,'foreign_key_violations_count':fk,'tables':results}

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: python3 verify-restore.py backup.sql NEW-output.sqlite')
    sql=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
    if target.exists():raise SystemExit('Refusing to overwrite existing database')
    inventory=json.loads(pathlib.Path(__file__).with_name('data-inventory.json').read_text())
    allowed=[inventory['export'],inventory['portable_restore']]
    actual=hashlib.sha256(sql.read_bytes()).hexdigest()
    if actual not in [v['sha256'] for v in allowed]:raise SystemExit('Backup checksum mismatch')
    target.parent.mkdir(parents=True,exist_ok=True);target.touch(mode=0o600)
    db=sqlite3.connect(target);db.executescript(sql.read_text());db.commit()
    report=verify(db,inventory);db.close();print(json.dumps(report,indent=2))
    raise SystemExit(0 if report['passed'] else 1)
