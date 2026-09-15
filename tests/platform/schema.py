"""Isolated in-memory database; never connects to a local or production D1."""
import sqlite3
import unittest
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[2] / 'migrations/events/0001_platform.sql'

class Isolation(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA.read_text())
        for event in ['a', 'b']:
            self.db.execute("INSERT INTO events(id,slug,title,draft_json,created_at,updated_at) VALUES(?,?,?,'{}',0,0)", (event,event,event))
            for position, kind in enumerate(['submission','voting','result']):
                self.db.execute('INSERT INTO event_stages(event_id,id,kind,title,position,accepting) VALUES(?,?,?,?,?,1)', (event,kind,kind,kind,position))
            self.db.execute("UPDATE events SET visibility='published',current_stage_id='submission' WHERE id=?", (event,))
            self.db.execute("INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES(?,?,'submission',1,'message',0)", (event,event+'-entry'))
            self.db.execute("INSERT INTO event_policies(event_id,id,kind,version,body,digest,created_at) VALUES(?,?,'privacy',1,'policy','digest',0)", (event,event+'-policy'))
        self.db.commit()

    def test_cross_event_candidate_source_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO event_candidates VALUES('a','voting',1,'c','b-entry','message',0,1)")

    def test_cross_event_consent_rejected(self):
        self.db.execute("INSERT INTO event_participants VALUES('a','p','a-entry',NULL,'{}','v1','{}',1)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO event_consents VALUES('a','p','b-policy',0)")

    def test_stage_change_blocks_entry_on_server(self):
        self.db.execute("UPDATE events SET current_stage_id='voting' WHERE id='a'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'ENTRY_CLOSED'):
            self.db.execute("INSERT INTO event_entries(event_id,id,stage_id,round,message,created_at) VALUES('a','late','submission',1,'late',0)")

    def test_votes_need_confirmed_candidate_and_open_stage(self):
        self.db.execute("INSERT INTO event_candidates VALUES('a','voting',1,'c','a-entry','message',0,0)")
        self.db.execute("UPDATE events SET current_stage_id='voting' WHERE id='a'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'VOTE_CLOSED'):
            self.db.execute("INSERT INTO event_votes VALUES('a','v','voting',1,'c',0)")
        self.db.execute("UPDATE event_candidates SET confirmed=1 WHERE event_id='a'")
        self.db.execute("INSERT INTO event_votes VALUES('a','v','voting',1,'c',0)")
        self.db.execute("INSERT INTO event_identity_claims VALUES('a','voting',1,'phone','hmac','v')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO event_identity_claims VALUES('a','voting',1,'phone','hmac','v')")

    def test_event_current_stage_cannot_reference_another_event(self):
        self.db.execute("INSERT INTO event_stages(event_id,id,kind,title,position) VALUES('b','only-b','result','result',3)")
        self.db.commit()
        self.db.execute("UPDATE events SET current_stage_id='only-b' WHERE id='a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.commit()

    def test_policies_and_audit_preserved(self):
        self.db.execute("INSERT INTO event_audit VALUES('audit','a',NULL,'test',NULL,'{}',0)")
        for statement in ["DELETE FROM event_policies WHERE event_id='a'", "DELETE FROM event_audit WHERE event_id='a'"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(statement)

if __name__ == '__main__': unittest.main(verbosity=2)
