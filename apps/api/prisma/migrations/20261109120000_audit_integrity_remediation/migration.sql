-- AlterForeignKey: Change AuditLog_actorUserId_fkey to ON DELETE RESTRICT
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorUserId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterForeignKey: Change AuditLog_targetTenantId_fkey to ON DELETE RESTRICT
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_targetTenantId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hardened AuditLog Immutability Trigger (Unconditional Protection)
-- Removes all references to session variable 'app.allow_test_audit_cleanup'.
-- Enforces unconditional rejection of UPDATE, DELETE, and TRUNCATE.
-- Normal INSERT operations remain strictly permitted.
-- =====================================================================

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog records are append-only and cannot be updated, deleted, or truncated (operation: %)', TG_OP
        USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- Recreate row-level trigger for UPDATE or DELETE
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

-- Create statement-level trigger for TRUNCATE
DROP TRIGGER IF EXISTS trg_audit_log_truncate ON "AuditLog";
CREATE TRIGGER trg_audit_log_truncate
    BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_audit_log_modification();
