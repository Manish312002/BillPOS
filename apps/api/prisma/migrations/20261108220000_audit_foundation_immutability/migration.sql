-- AlterTable: Add audit foundation fields to AuditLog
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorRole" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "module" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "supportSessionId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;

-- CreateIndex: Add performance indexes for audit filtering and correlation
CREATE INDEX IF NOT EXISTS "AuditLog_module_idx" ON "AuditLog"("module");
CREATE INDEX IF NOT EXISTS "AuditLog_status_idx" ON "AuditLog"("status");
CREATE INDEX IF NOT EXISTS "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX IF NOT EXISTS "AuditLog_supportSessionId_idx" ON "AuditLog"("supportSessionId");

-- =====================================================================
-- PostgreSQL AuditLog Immutability Trigger
-- Rejects UPDATE and DELETE operations on AuditLog records.
-- INSERT operations remain permitted.
-- Controlled test teardown is isolated via session setting 'app.allow_test_audit_cleanup'.
-- =====================================================================

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  -- Controlled test cleanup check:
  -- Only allow deletion/update if explicitly enabled in the current database session for test teardown
  IF current_setting('app.allow_test_audit_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'AuditLog records are append-only and cannot be updated or deleted (operation: %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON "AuditLog";

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_modification();
