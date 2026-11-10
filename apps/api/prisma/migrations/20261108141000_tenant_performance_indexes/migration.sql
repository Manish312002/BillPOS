-- Drop redundant index on slug (already enforced by unique constraint Tenant_slug_key)
DROP INDEX IF EXISTS "Tenant_slug_idx";

-- Create composite index for status-filtered pagination
CREATE INDEX IF NOT EXISTS "Tenant_status_createdAt_idx" ON "Tenant"("status", "createdAt");

-- Create index for default timestamp pagination
CREATE INDEX IF NOT EXISTS "Tenant_createdAt_idx" ON "Tenant"("createdAt");
