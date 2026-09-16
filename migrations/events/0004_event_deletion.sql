-- Preserve immutable policies/audit records except during a confirmed, event-scoped
-- deletion transaction. No rows are changed by this migration.
DROP TRIGGER policy_no_delete;
CREATE TRIGGER policy_no_delete BEFORE DELETE ON event_policies
WHEN NOT EXISTS (SELECT 1 FROM event_operation_guards WHERE id='delete-event:'||OLD.event_id AND ok=1)
BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
DROP TRIGGER audit_no_delete;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON event_audit
WHEN NOT EXISTS (SELECT 1 FROM event_operation_guards WHERE id='delete-event:'||OLD.event_id AND ok=1)
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
