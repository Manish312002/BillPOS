-- =====================================================================
-- Migration: 20261110180000_plan_price_historical_uniqueness
-- WP-SUB-02 Slice 1 Targeted Closure: Historical PlanPrice Uniqueness
-- =====================================================================

-- 1. Drop the restrictive unique index that prevented multiple inactive historical prices
DROP INDEX IF EXISTS "PlanPrice_planId_billingCycle_isActive_key";

-- 2. Create index for efficient status-filtered plan price lookups
CREATE INDEX IF NOT EXISTS "PlanPrice_planId_billingCycle_isActive_idx" 
ON "PlanPrice"("planId", "billingCycle", "isActive");

-- 3. PostgreSQL Partial Unique Index: Single Active Price per Plan & Billing Cycle
-- Guarantees that at the database engine level, a plan can have at most ONE active price
-- per billing cycle, while permitting unlimited historical inactive prices (isActive = false).
CREATE UNIQUE INDEX "idx_plan_prices_single_active" 
ON "PlanPrice" ("planId", "billingCycle") 
WHERE "isActive" = true;
