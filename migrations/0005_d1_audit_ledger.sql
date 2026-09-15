-- Additive migration: preserve legacy event/outbox/ledger rows and their original locations.
ALTER TABLE audit_outbox ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'LEGACY' CHECK(storage_backend IN ('LEGACY','D1'));
ALTER TABLE deletion_ledger ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'LEGACY' CHECK(storage_backend IN ('LEGACY','D1'));
ALTER TABLE deletion_ledger ADD COLUMN payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json));
ALTER TABLE deletion_ledger ADD COLUMN digest TEXT;
ALTER TABLE deletion_ledger ADD COLUMN retention_until INTEGER NOT NULL DEFAULT 0;
UPDATE deletion_ledger SET retention_until = MAX(occurred_at + 31536000000, restore_residue_until);
ALTER TABLE deletion_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE deletion_jobs ADD COLUMN lease_until INTEGER;
CREATE UNIQUE INDEX deletion_d1_event ON deletion_ledger(job_id,event) WHERE storage_backend='D1';
CREATE INDEX deletion_ledger_retention ON deletion_ledger(retention_until);

CREATE TRIGGER deletion_ledger_d1_fields BEFORE INSERT ON deletion_ledger WHEN NEW.storage_backend='D1' BEGIN
 SELECT CASE WHEN NEW.event NOT IN ('INTENT','COMPLETE') OR NEW.payload_json IS NULL
 OR NEW.digest IS NULL OR length(NEW.digest)<>64 OR NEW.retention_until<NEW.restore_residue_until
 OR NEW.r2_key IS NOT NULL OR NEW.archived_at IS NOT NULL
 THEN RAISE(ABORT,'INVALID_D1_LEDGER') END;
END;
CREATE TRIGGER deletion_ledger_immutable BEFORE UPDATE ON deletion_ledger BEGIN SELECT RAISE(ABORT,'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER deletion_ledger_retention_gate BEFORE DELETE ON deletion_ledger BEGIN
 SELECT CASE WHEN OLD.retention_until>CAST(strftime('%s','now') AS INTEGER)*1000
 OR EXISTS(SELECT 1 FROM deletion_jobs WHERE id=OLD.job_id AND state<>'VERIFIED')
 THEN RAISE(ABORT,'LEDGER_RETENTION') END;
END;
CREATE TRIGGER audit_seal_immutable BEFORE UPDATE ON audit_outbox WHEN OLD.delivered_at IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'AUDIT_SEAL_IMMUTABLE');
END;
CREATE TRIGGER audit_seal_valid BEFORE UPDATE ON audit_outbox WHEN NEW.storage_backend='D1' AND NEW.delivered_at IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.digest IS NULL OR length(NEW.digest)<>64 THEN RAISE(ABORT,'AUDIT_SEAL_REQUIRED') END;
END;
-- Keep the seal until the retained parent event can be removed; clean it in the parent's delete trigger.
CREATE TRIGGER audit_seal_delete_gate BEFORE DELETE ON audit_outbox BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events WHERE id=OLD.event_id) THEN RAISE(ABORT,'AUDIT_SEAL_REQUIRED') END;
END;
DROP TRIGGER audit_delete_gate;
CREATE TRIGGER audit_delete_gate BEFORE DELETE ON audit_events BEGIN
 SELECT CASE WHEN OLD.retention_until>CAST(strftime('%s','now') AS INTEGER)*1000
 OR NOT EXISTS(SELECT 1 FROM audit_outbox WHERE event_id=OLD.id AND delivered_at IS NOT NULL AND digest IS NOT NULL)
 THEN RAISE(ABORT,'AUDIT_RETENTION') END;
END;
CREATE TRIGGER audit_delete_seal AFTER DELETE ON audit_events BEGIN DELETE FROM audit_outbox WHERE event_id=OLD.id; END;
