import { prisma as defaultPrisma } from '../db/client.js';
import * as auditService from './audit.service.js';
import {
  SUBSCRIPTION_STATUS,
  ACTIVE_SUBSCRIPTION_STATUSES,
  HISTORICAL_SUBSCRIPTION_STATUSES,
  BILLING_CYCLE,
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  AUDIT_ACTIONS,
  AUDIT_STATUS,
  SUBSCRIPTION_ERROR_CODES,
  toTenantSubscriptionDto,
} from '@billingbuddy/shared';

/**
 * Standard durations in milliseconds
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_TRIAL_DAYS = 14;
export const GRACE_PERIOD_DAYS = 3;
export const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * MS_PER_DAY; // 72 hours (Decision D-04)

/**
 * Permitted single-row state transitions for TenantSubscription
 * Enforces state machine invariants across all 11 lifecycle coordination scenarios
 */
export const VALID_LIFECYCLE_TRANSITIONS = Object.freeze({
  [SUBSCRIPTION_STATUS.TRIAL]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.GRACE_PERIOD,
    SUBSCRIPTION_STATUS.CANCELED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ],
  [SUBSCRIPTION_STATUS.ACTIVE]: [
    SUBSCRIPTION_STATUS.ACTIVE, // Extension or renewal
    SUBSCRIPTION_STATUS.GRACE_PERIOD,
    SUBSCRIPTION_STATUS.CANCELED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ],
  [SUBSCRIPTION_STATUS.GRACE_PERIOD]: [
    SUBSCRIPTION_STATUS.ACTIVE, // Payment verified or manual extension
    SUBSCRIPTION_STATUS.READ_ONLY,
    SUBSCRIPTION_STATUS.CANCELED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ],
  [SUBSCRIPTION_STATUS.READ_ONLY]: [
    SUBSCRIPTION_STATUS.ACTIVE, // Payment verified or manual extension
    SUBSCRIPTION_STATUS.EXPIRED,
    SUBSCRIPTION_STATUS.CANCELED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ],
  [SUBSCRIPTION_STATUS.SUSPENDED]: [
    SUBSCRIPTION_STATUS.TRIAL,
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.GRACE_PERIOD,
    SUBSCRIPTION_STATUS.READ_ONLY,
    SUBSCRIPTION_STATUS.CANCELED,
    SUBSCRIPTION_STATUS.EXPIRED,
  ],
  // Historical terminal states: direct in-place modification prohibited.
  // Resubscription requires inserting a NEW TenantSubscription row.
  [SUBSCRIPTION_STATUS.CANCELED]: [],
  [SUBSCRIPTION_STATUS.EXPIRED]: [],
});

/**
 * Assert that a state transition on an existing subscription row is valid.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {Error} if transition is prohibited by state machine
 */
export function assertValidTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return;
  const allowed = VALID_LIFECYCLE_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    const error = new Error(
      `Invalid subscription transition from "${fromStatus}" to "${toStatus}". Direct in-place mutation prohibited.`
    );
    error.code = SUBSCRIPTION_ERROR_CODES.INVALID_SUBSCRIPTION_TRANSITION;
    error.statusCode = 422;
    throw error;
  }
}

/**
 * Asserts tenant isolation. Rejects cross-tenant access attempts.
 *
 * @param {string} targetTenantId - The tenantId of the requested resource
 * @param {string} [authorizedTenantId] - The tenantId of the caller context (if scoped to tenant)
 * @throws {Error} if caller tenantId does not match target tenantId
 */
export function assertTenantAuthorization(targetTenantId, authorizedTenantId) {
  if (authorizedTenantId !== undefined && authorizedTenantId !== null) {
    if (authorizedTenantId !== targetTenantId) {
      const error = new Error('Access denied: cross-tenant subscription access is prohibited');
      error.code = 'TENANT_ACCESS_DENIED';
      error.statusCode = 403;
      throw error;
    }
  }
}

/**
 * Asserts platform superadmin privilege for administrative subscription operations.
 *
 * @param {string} actorRole - Role of the initiating actor
 * @throws {Error} if actorRole is not SUPERADMIN
 */
export function assertSuperadminAuthorization(actorRole) {
  if (actorRole !== 'SUPERADMIN') {
    const error = new Error('Access denied: operation requires SUPERADMIN platform authorization');
    error.code = 'UNAUTHORIZED_ROLE';
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Acquires a pessimistic row-level lock on any active subscription for the tenant.
 * Serializes concurrent lifecycle operations and mutations within a transaction.
 * Aligns strictly with idx_tenant_subscriptions_single_active:
 * WHERE "status" IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'READ_ONLY', 'SUSPENDED')
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {object} client - Prisma transaction client
 * @returns {Promise<Array<object>>}
 */
export async function lockActiveSubscription(tenantId, client) {
  return client.$queryRaw`
    SELECT "id", "status"
    FROM "TenantSubscription"
    WHERE "tenantId" = ${tenantId}
      AND "status"::text IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'READ_ONLY', 'SUSPENDED')
    FOR UPDATE
  `;
}

/**
 * Retrieve the current active subscription for a tenant, if any exists.
 * Governed by the partial unique index idx_tenant_subscriptions_single_active.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {object} [options]
 * @param {object} [options.tx] - Optional Prisma transaction client
 * @param {boolean} [options.includeRelations=true]
 * @param {string} [options.authorizedTenantId] - Caller tenant authorization scope
 * @returns {Promise<object|null>}
 */
export async function getActiveSubscription(tenantId, options = {}) {
  const { tx = defaultPrisma, includeRelations = true, authorizedTenantId } = options;
  assertTenantAuthorization(tenantId, authorizedTenantId);

  return tx.tenantSubscription.findFirst({
    where: {
      tenantId,
      status: {
        in: ACTIVE_SUBSCRIPTION_STATUSES,
      },
    },
    include: includeRelations
      ? {
          plan: {
            include: {
              prices: true,
              features: true,
            },
          },
          planPrice: true,
          overrides: true,
        }
      : undefined,
  });
}

/**
 * Retrieve the complete historical subscription ledger for a tenant.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {object} [options]
 * @param {object} [options.tx] - Optional Prisma transaction client
 * @param {string} [options.authorizedTenantId] - Caller tenant authorization scope
 * @returns {Promise<Array<object>>}
 */
export async function getSubscriptionHistory(tenantId, options = {}) {
  const { tx = defaultPrisma, authorizedTenantId } = options;
  assertTenantAuthorization(tenantId, authorizedTenantId);

  return tx.tenantSubscription.findMany({
    where: { tenantId },
    include: {
      plan: {
        include: {
          prices: true,
          features: true,
        },
      },
      planPrice: true,
      overrides: true,
      invoices: {
        include: {
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find or provision baseline TRIAL_14 plan in database.
 * Resilient helper ensuring trial plan availability.
 *
 * @param {object} client - Prisma client or transaction
 * @returns {Promise<object>}
 */
async function getOrProvisionTrialPlan(client) {
  let trialPlan = await client.plan.findFirst({
    where: {
      OR: [{ code: 'TRIAL_14' }, { trialDays: { gt: 0 } }],
      isActive: true,
    },
    include: { prices: true, features: true },
  });

  if (!trialPlan) {
    trialPlan = await client.plan.upsert({
      where: { code: 'TRIAL_14' },
      create: {
        code: 'TRIAL_14',
        name: '14-Day Free Trial',
        description: 'Standard 14-day full feature trial',
        trialDays: 14,
        isActive: true,
        isPublic: false,
        version: 1,
        sortOrder: 0,
        features: {
          create: [
            { featureKey: 'max_outlets', valueType: 'NUMERIC', numericValue: 1 },
            { featureKey: 'max_users', valueType: 'NUMERIC', numericValue: 2 },
            { featureKey: 'max_devices', valueType: 'NUMERIC', numericValue: 2 },
            { featureKey: 'max_products', valueType: 'NUMERIC', numericValue: 500 },
            { featureKey: 'offline_pos', valueType: 'BOOLEAN', booleanValue: true },
            { featureKey: 'advanced_reports', valueType: 'BOOLEAN', booleanValue: false },
          ],
        },
      },
      update: {},
      include: { prices: true, features: true },
    });
  }

  return trialPlan;
}

/**
 * Automatically provisions a 14-day trial subscription for a newly activated tenant.
 * Fulfills Decision D-03: Automatic 14-day trial for each newly activated tenant.
 * Idempotent: If tenant already has an active subscription, returns it without error.
 *
 * @param {object} params
 * @param {string} params.tenantId - UUID of the tenant
 * @param {string} [params.actorUserId] - ID of actor triggering trial (e.g. newly activated owner)
 * @param {string} [params.actorRole='STORE_OWNER']
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx] - Optional Prisma transaction client
 * @returns {Promise<object>} Created or existing TenantSubscription
 */
export async function provisionTrialSubscription({
  tenantId,
  actorUserId = null,
  actorRole = 'STORE_OWNER',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const execute = async (client) => {
    // 1. Idempotency Check: Does active subscription already exist?
    const existing = await getActiveSubscription(tenantId, { tx: client });
    if (existing) {
      return existing;
    }

    // 2. Fetch or prepare trial plan
    const trialPlan = await getOrProvisionTrialPlan(client);
    const trialDays = trialPlan.trialDays > 0 ? trialPlan.trialDays : DEFAULT_TRIAL_DAYS;

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * MS_PER_DAY);

    // 3. Create TenantSubscription row
    const subscription = await client.tenantSubscription.create({
      data: {
        tenantId,
        planId: trialPlan.id,
        planPriceId: trialPlan.prices?.[0]?.id || null,
        status: SUBSCRIPTION_STATUS.TRIAL,
        billingCycle: BILLING_CYCLE.MONTHLY,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
        leaseVersion: 1,
        metadata: {
          provisionedVia: 'AUTOMATIC_TENANT_ACTIVATION',
          trialDays,
        },
      },
      include: {
        plan: {
          include: { prices: true, features: true },
        },
        planPrice: true,
        overrides: true,
      },
    });

    // 4. Record Immutable Audit Event
    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
      action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_STARTED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: subscription.id,
      metadata: {
        planCode: trialPlan.code,
        trialDays,
        trialEndsAt: trialEndsAt.toISOString(),
      },
      ipAddress,
      userAgent,
    });

    return subscription;
  };

  try {
    if (parentTx) {
      return await execute(parentTx);
    }
    return await defaultPrisma.$transaction(execute);
  } catch (err) {
    // Area A: Concurrent trial provisioning collision handling
    // If a concurrent transaction won the race, partial unique index
    // idx_tenant_subscriptions_single_active will throw a P2002 constraint error.
    if (err.code === 'P2002' || err.message?.includes('idx_tenant_subscriptions_single_active')) {
      const active = await getActiveSubscription(tenantId, { tx: parentTx || defaultPrisma });
      if (active) {
        return active;
      }
    }
    throw err;
  }
}

/**
 * Assigns or migrates a commercial subscription plan to a tenant.
 * Handles Superadmin manual plan assignment, upgrades, and migrations (D-08).
 * If an active subscription exists, updates it in-place and increments leaseVersion.
 * If no active subscription exists, inserts a new active subscription row.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.planCode - e.g. "STARTER", "GROWTH", "ENTERPRISE"
 * @param {string} params.billingCycle - "MONTHLY" or "ANNUAL"
 * @param {string} params.actorUserId - Superadmin User ID
 * @param {string} params.reason - Mandatory justification (>= 10 chars)
 * @param {string} [params.actorRole='SUPERADMIN']
 * @param {string} [params.authorizedTenantId]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Updated or created TenantSubscription
 */
export async function assignPlan({
  tenantId,
  planCode,
  billingCycle = BILLING_CYCLE.MONTHLY,
  actorUserId,
  reason,
  actorRole = 'SUPERADMIN',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertSuperadminAuthorization(actorRole);
  assertTenantAuthorization(tenantId, authorizedTenantId);

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const error = new Error('Mandatory audit justification reason must be at least 10 characters');
    error.statusCode = 400;
    throw error;
  }

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to serialize concurrent transitions/mutations
    await lockActiveSubscription(tenantId, client);

    // 1. Resolve Target Plan
    const targetPlan = await client.plan.findUnique({
      where: { code: planCode },
      include: {
        prices: { where: { isActive: true } },
        features: true,
      },
    });

    if (!targetPlan || !targetPlan.isActive) {
      const error = new Error(`Plan "${planCode}" is inactive or does not exist`);
      error.statusCode = 404;
      throw error;
    }

    // 2. Resolve Active Price for Billing Cycle
    const targetPrice = targetPlan.prices.find((p) => p.billingCycle === billingCycle);
    if (!targetPrice) {
      const error = new Error(`No active price configured for plan "${planCode}" with billing cycle "${billingCycle}"`);
      error.statusCode = 400;
      throw error;
    }

    const now = new Date();
    const periodDays = billingCycle === BILLING_CYCLE.ANNUAL ? 365 : 30;
    const currentPeriodEnd = new Date(now.getTime() + periodDays * MS_PER_DAY);

    // 3. Find current active subscription
    const existing = await getActiveSubscription(tenantId, { tx: client });

    let updatedSubscription;
    let auditAction;

    if (existing) {
      // In-place upgrade/migration of current subscription
      assertValidTransition(existing.status, SUBSCRIPTION_STATUS.ACTIVE);

      updatedSubscription = await client.tenantSubscription.update({
        where: { id: existing.id },
        data: {
          planId: targetPlan.id,
          planPriceId: targetPrice.id,
          billingCycle,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd,
          gracePeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          cancellationReason: null,
          leaseVersion: { increment: 1 },
          metadata: {
            ...(existing.metadata || {}),
            lastPlanChangeReason: reason.trim(),
            previousPlanId: existing.planId,
            assignedBy: actorUserId,
          },
        },
        include: {
          plan: { include: { prices: true, features: true } },
          planPrice: true,
          overrides: true,
        },
      });

      auditAction = AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED;
    } else {
      // New active subscription assignment
      updatedSubscription = await client.tenantSubscription.create({
        data: {
          tenantId,
          planId: targetPlan.id,
          planPriceId: targetPrice.id,
          billingCycle,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd,
          gracePeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          leaseVersion: 1,
          metadata: {
            assignedBy: actorUserId,
            reason: reason.trim(),
          },
        },
        include: {
          plan: { include: { prices: true, features: true } },
          planPrice: true,
          overrides: true,
        },
      });

      auditAction = AUDIT_ACTIONS.SUBSCRIPTION_PLAN_ASSIGNED;
    }

    // 4. Audit Log Entry
    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_MUTATION,
      action: auditAction,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: updatedSubscription.id,
      metadata: {
        planCode: targetPlan.code,
        billingCycle,
        reason: reason.trim(),
        currentPeriodEnd: currentPeriodEnd.toISOString(),
      },
      ipAddress,
      userAgent,
    });

    return updatedSubscription;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Manually extends the subscription period for a tenant.
 * Fulfills Scenario 7 (Clarification C & Decision D-08): Superadmin grants complimentary days.
 * If tenant is in GRACE_PERIOD or READ_ONLY, operational access is restored to ACTIVE.
 * Emits SUBSCRIPTION_PERIOD_EXTENDED with structured diff. Zero payment records created.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {number} params.extensionDays - Integer days to extend (1 - 365)
 * @param {string} params.actorUserId - Superadmin User ID
 * @param {string} params.reason - Mandatory justification (>= 10 chars)
 * @param {string} [params.actorRole='SUPERADMIN']
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Updated TenantSubscription
 */
export async function extendSubscriptionPeriod({
  tenantId,
  extensionDays,
  actorUserId,
  reason,
  actorRole = 'SUPERADMIN',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertSuperadminAuthorization(actorRole);
  assertTenantAuthorization(tenantId, authorizedTenantId);

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const error = new Error('Mandatory audit justification reason must be at least 10 characters');
    error.statusCode = 400;
    throw error;
  }

  const parsedDays = Number(extensionDays);
  if (!Number.isSafeInteger(parsedDays) || parsedDays <= 0 || parsedDays > 365) {
    const error = new Error('Extension days must be a positive integer between 1 and 365');
    error.statusCode = 400;
    throw error;
  }

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to serialize concurrent state mutations
    await lockActiveSubscription(tenantId, client);

    const existing = await getActiveSubscription(tenantId, { tx: client });
    if (!existing) {
      const error = new Error('No active subscription found to extend for this tenant');
      error.statusCode = 404;
      throw error;
    }

    const previousStatus = existing.status;
    const previousPeriodEnd = existing.currentPeriodEnd;

    // Calculate new currentPeriodEnd: if currentPeriodEnd is in future, add from it; if past, add from now
    const now = new Date();
    const baseDate = existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
    const newPeriodEnd = new Date(baseDate.getTime() + parsedDays * MS_PER_DAY);

    // If subscription was in GRACE_PERIOD or READ_ONLY, restore status to ACTIVE
    const newStatus =
      existing.status === SUBSCRIPTION_STATUS.GRACE_PERIOD ||
      existing.status === SUBSCRIPTION_STATUS.READ_ONLY
        ? SUBSCRIPTION_STATUS.ACTIVE
        : existing.status;

    const updated = await client.tenantSubscription.update({
      where: { id: existing.id },
      data: {
        status: newStatus,
        currentPeriodEnd: newPeriodEnd,
        gracePeriodEndsAt: null,
        leaseVersion: { increment: 1 },
        metadata: {
          ...(existing.metadata || {}),
          lastExtensionDays: parsedDays,
          lastExtensionReason: reason.trim(),
          extendedBy: actorUserId,
        },
      },
      include: {
        plan: { include: { prices: true, features: true } },
        planPrice: true,
        overrides: true,
      },
    });

    // Record Immutable Audit Event with structured diff
    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_MUTATION,
      action: AUDIT_ACTIONS.SUBSCRIPTION_PERIOD_EXTENDED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: updated.id,
      metadata: {
        diff: {
          before: {
            status: previousStatus,
            currentPeriodEnd: previousPeriodEnd.toISOString(),
          },
          after: {
            status: newStatus,
            currentPeriodEnd: newPeriodEnd.toISOString(),
          },
        },
        extensionDays: parsedDays,
        reason: reason.trim(),
      },
      ipAddress,
      userAgent,
    });

    return updated;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Schedules subscription cancellation at the conclusion of current term.
 * Fulfills Scenario 10 (Clarification C): Owner requests scheduled cancellation.
 * Subscription status remains ACTIVE; access continues until currentPeriodEnd.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} [params.cancellationReason]
 * @param {string} params.actorUserId
 * @param {string} [params.actorRole='STORE_OWNER']
 * @param {string} [params.authorizedTenantId]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Updated TenantSubscription
 */
export async function scheduleCancellation({
  tenantId,
  cancellationReason = 'Store owner requested cancellation at period end',
  actorUserId,
  actorRole = 'STORE_OWNER',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to serialize concurrent state mutations
    await lockActiveSubscription(tenantId, client);

    const existing = await getActiveSubscription(tenantId, { tx: client });
    if (!existing) {
      const error = new Error('No active subscription found to schedule cancellation');
      error.statusCode = 404;
      throw error;
    }

    if (existing.cancelAtPeriodEnd) {
      return existing; // Idempotent
    }

    const updated = await client.tenantSubscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: true,
        cancellationReason: cancellationReason.trim(),
      },
      include: {
        plan: true,
        planPrice: true,
      },
    });

    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCEL_SCHEDULED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: updated.id,
      metadata: {
        effectiveCancellationDate: existing.currentPeriodEnd.toISOString(),
        reason: cancellationReason.trim(),
      },
      ipAddress,
      userAgent,
    });

    return updated;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Rescinds a previously scheduled cancellation before the period concludes.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.actorUserId
 * @param {string} [params.actorRole='STORE_OWNER']
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Updated TenantSubscription
 */
export async function rescindScheduledCancellation({
  tenantId,
  actorUserId,
  actorRole = 'STORE_OWNER',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to serialize concurrent state mutations
    await lockActiveSubscription(tenantId, client);

    const existing = await getActiveSubscription(tenantId, { tx: client });
    if (!existing) {
      const error = new Error('No active subscription found');
      error.statusCode = 404;
      throw error;
    }

    if (!existing.cancelAtPeriodEnd) {
      return existing; // Already not scheduled
    }

    const updated = await client.tenantSubscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: false,
        cancellationReason: null,
      },
      include: {
        plan: true,
        planPrice: true,
      },
    });

    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCEL_RESCINDED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: updated.id,
      metadata: {
        rescindedAt: new Date().toISOString(),
      },
      ipAddress,
      userAgent,
    });

    return updated;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Immediately cancels a tenant subscription administratively.
 * Terminal transition: updates status to CANCELED and records canceledAt.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.reason - Justification for immediate cancellation
 * @param {string} params.actorUserId
 * @param {string} [params.actorRole='SUPERADMIN']
 * @param {string} [params.authorizedTenantId]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Updated TenantSubscription
 */
export async function cancelSubscriptionImmediately({
  tenantId,
  reason,
  actorUserId,
  actorRole = 'SUPERADMIN',
  authorizedTenantId,
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertSuperadminAuthorization(actorRole);
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to serialize concurrent cancellations
    await lockActiveSubscription(tenantId, client);

    const existing = await getActiveSubscription(tenantId, { tx: client });
    if (!existing) {
      const error = new Error('No active subscription found to cancel');
      error.statusCode = 404;
      throw error;
    }

    assertValidTransition(existing.status, SUBSCRIPTION_STATUS.CANCELED);

    const now = new Date();
    const updated = await client.tenantSubscription.update({
      where: { id: existing.id },
      data: {
        status: SUBSCRIPTION_STATUS.CANCELED,
        canceledAt: now,
        cancellationReason: (reason || 'Immediate administrative cancellation').trim(),
        leaseVersion: { increment: 1 },
      },
      include: {
        plan: true,
        planPrice: true,
      },
    });

    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: updated.id,
      metadata: {
        canceledAt: now.toISOString(),
        reason: reason?.trim() || null,
        immediate: true,
      },
      ipAddress,
      userAgent,
    });

    return updated;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Reactivates a tenant subscription after past cancellation or expiration.
 * Fulfills Scenario 11 (Clarification C): Tenant resubscribes after cancellation.
 * Critical Invariant: Past canceled/expired subscription row is PRESERVED intact.
 * A NEW TenantSubscription row is created with status = 'ACTIVE' (permitted by partial unique index).
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.planCode
 * @param {string} params.billingCycle
 * @param {string} params.actorUserId
 * @param {string} [params.actorRole='STORE_OWNER']
 * @param {string} [params.authorizedTenantId]
 * @param {string} [params.reason='Subscription reactivated by tenant']
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.tx]
 * @returns {Promise<object>} Newly created TenantSubscription
 */
export async function reactivateSubscription({
  tenantId,
  planCode,
  billingCycle = BILLING_CYCLE.MONTHLY,
  actorUserId,
  actorRole = 'STORE_OWNER',
  authorizedTenantId,
  reason = 'Subscription reactivated by tenant',
  ipAddress = null,
  userAgent = null,
  tx: parentTx = null,
}) {
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const execute = async (client) => {
    // Area B: Pessimistic Row Locking to guard against racing reactivation calls
    await lockActiveSubscription(tenantId, client);

    // 1. Guard against duplicate active subscription
    const currentActive = await getActiveSubscription(tenantId, { tx: client });
    if (currentActive) {
      const error = new Error(
        `Tenant already has an active subscription in "${currentActive.status}" status. Use plan change or renewal.`
      );
      error.statusCode = 409;
      throw error;
    }

    // 2. Fetch Plan & Price
    const plan = await client.plan.findUnique({
      where: { code: planCode },
      include: { prices: { where: { isActive: true } } },
    });
    if (!plan || !plan.isActive) {
      const error = new Error(`Plan "${planCode}" is inactive or does not exist`);
      error.statusCode = 404;
      throw error;
    }

    const price = plan.prices.find((p) => p.billingCycle === billingCycle);
    if (!price) {
      const error = new Error(`No active price configured for plan "${planCode}" with billing cycle "${billingCycle}"`);
      error.statusCode = 400;
      throw error;
    }

    const now = new Date();
    const periodDays = billingCycle === BILLING_CYCLE.ANNUAL ? 365 : 30;
    const currentPeriodEnd = new Date(now.getTime() + periodDays * MS_PER_DAY);

    // 3. Insert NEW TenantSubscription row (guaranteed by partial unique index)
    const newSubscription = await client.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        planPriceId: price.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd,
        gracePeriodEndsAt: null,
        cancelAtPeriodEnd: false,
        leaseVersion: 1,
        metadata: {
          reactivatedAt: now.toISOString(),
          reactivatedBy: actorUserId,
          reason: reason.trim(),
        },
      },
      include: {
        plan: { include: { prices: true, features: true } },
        planPrice: true,
        overrides: true,
      },
    });

    // 4. Record Audit Event
    await auditService.recordAuditEvent({
      tx: client,
      actorUserId,
      actorRole,
      targetTenantId: tenantId,
      module: AUDIT_MODULES.BILLING,
      eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
      action: AUDIT_ACTIONS.SUBSCRIPTION_REACTIVATED,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'TENANT_SUBSCRIPTION',
      resourceId: newSubscription.id,
      metadata: {
        planCode: plan.code,
        billingCycle,
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        reason: reason.trim(),
      },
      ipAddress,
      userAgent,
    });

    return newSubscription;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Background Cron Job Runner: Evaluates subscription lifecycle expirations and advances statuses.
 * Coordinates:
 * - Trial Expirations -> GRACE_PERIOD (72h)
 * - Active Term Conclusions:
 *     - If cancelAtPeriodEnd == true -> CANCELED
 *     - If cancelAtPeriodEnd == false -> GRACE_PERIOD (72h)
 * - Grace Period Expirations -> READ_ONLY (Decision D-04)
 *
 * @param {object} [options]
 * @param {Date} [options.now=new Date()]
 * @param {object} [options.tx]
 * @returns {Promise<object>} Summary of transitioned subscriptions
 */
export async function runSubscriptionLifecycleCron(options = {}) {
  const { now = new Date(), tx: parentTx = null } = options;

  const execute = async (client) => {
    const summary = {
      trialsExpired: 0,
      activeToGrace: 0,
      scheduledCanceled: 0,
      graceToReadOnly: 0,
      processedCount: 0,
    };

    // 1. Process Expired Trials (trialEndsAt < now)
    const expiredTrials = await client.tenantSubscription.findMany({
      where: {
        status: SUBSCRIPTION_STATUS.TRIAL,
        trialEndsAt: { lt: now },
      },
    });

    for (const sub of expiredTrials) {
      const gracePeriodEndsAt = new Date(sub.trialEndsAt.getTime() + GRACE_PERIOD_MS);

      // Optimistic concurrency check: only update if status is still TRIAL
      const updated = await client.tenantSubscription.updateMany({
        where: {
          id: sub.id,
          status: SUBSCRIPTION_STATUS.TRIAL,
        },
        data: {
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          gracePeriodEndsAt,
          leaseVersion: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        // Concurrently processed by another worker; skip duplicate transition and audit log
        continue;
      }

      await auditService.recordAuditEvent({
        tx: client,
        actorUserId: null,
        actorRole: 'SYSTEM_CRON',
        targetTenantId: sub.tenantId,
        module: AUDIT_MODULES.BILLING,
        eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
        action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_ENTERED,
        status: AUDIT_STATUS.SUCCESS,
        resourceType: 'TENANT_SUBSCRIPTION',
        resourceId: sub.id,
        metadata: {
          sourceStatus: SUBSCRIPTION_STATUS.TRIAL,
          gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
        },
      });

      summary.trialsExpired += 1;
      summary.processedCount += 1;
    }

    // 2. Process Concluded Active Subscriptions (currentPeriodEnd < now)
    const concludedActive = await client.tenantSubscription.findMany({
      where: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodEnd: { lt: now },
      },
    });

    for (const sub of concludedActive) {
      if (sub.cancelAtPeriodEnd) {
        // Scheduled cancellation concludes
        const updated = await client.tenantSubscription.updateMany({
          where: {
            id: sub.id,
            status: SUBSCRIPTION_STATUS.ACTIVE,
          },
          data: {
            status: SUBSCRIPTION_STATUS.CANCELED,
            canceledAt: now,
            leaseVersion: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          continue;
        }

        await auditService.recordAuditEvent({
          tx: client,
          actorUserId: null,
          actorRole: 'SYSTEM_CRON',
          targetTenantId: sub.tenantId,
          module: AUDIT_MODULES.BILLING,
          eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
          action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
          status: AUDIT_STATUS.SUCCESS,
          resourceType: 'TENANT_SUBSCRIPTION',
          resourceId: sub.id,
          metadata: {
            scheduledCancellationExecuted: true,
            canceledAt: now.toISOString(),
          },
        });

        summary.scheduledCanceled += 1;
      } else {
        // Enters 72-hour grace period (Decision D-04)
        const gracePeriodEndsAt = new Date(sub.currentPeriodEnd.getTime() + GRACE_PERIOD_MS);

        const updated = await client.tenantSubscription.updateMany({
          where: {
            id: sub.id,
            status: SUBSCRIPTION_STATUS.ACTIVE,
          },
          data: {
            status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
            gracePeriodEndsAt,
            leaseVersion: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          continue;
        }

        await auditService.recordAuditEvent({
          tx: client,
          actorUserId: null,
          actorRole: 'SYSTEM_CRON',
          targetTenantId: sub.tenantId,
          module: AUDIT_MODULES.BILLING,
          eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
          action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_ENTERED,
          status: AUDIT_STATUS.SUCCESS,
          resourceType: 'TENANT_SUBSCRIPTION',
          resourceId: sub.id,
          metadata: {
            sourceStatus: SUBSCRIPTION_STATUS.ACTIVE,
            gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
          },
        });

        summary.activeToGrace += 1;
      }

      summary.processedCount += 1;
    }

    // 3. Process Concluded Grace Periods -> READ_ONLY mode (Decision D-04)
    const concludedGrace = await client.tenantSubscription.findMany({
      where: {
        status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
        gracePeriodEndsAt: { lt: now },
      },
    });

    for (const sub of concludedGrace) {
      const updated = await client.tenantSubscription.updateMany({
        where: {
          id: sub.id,
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
        },
        data: {
          status: SUBSCRIPTION_STATUS.READ_ONLY,
          leaseVersion: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        continue;
      }

      await auditService.recordAuditEvent({
        tx: client,
        actorUserId: null,
        actorRole: 'SYSTEM_CRON',
        targetTenantId: sub.tenantId,
        module: AUDIT_MODULES.BILLING,
        eventType: AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE,
        action: AUDIT_ACTIONS.SUBSCRIPTION_READ_ONLY_ENTERED,
        status: AUDIT_STATUS.SUCCESS,
        resourceType: 'TENANT_SUBSCRIPTION',
        resourceId: sub.id,
        metadata: {
          gracePeriodExpiredAt: sub.gracePeriodEndsAt?.toISOString() || null,
          readOnlyEnteredAt: now.toISOString(),
        },
      });

      summary.graceToReadOnly += 1;
      summary.processedCount += 1;
    }

    return summary;
  };

  if (parentTx) {
    return execute(parentTx);
  }
  return defaultPrisma.$transaction(execute);
}

/**
 * Dynamically evaluates subscription status against time boundaries,
 * verifying decoupling from Tenant.status (Scenario 8 & 9).
 * If Tenant.status is SUSPENDED, platform access is blocked independently,
 * while TenantSubscription.status remains preserved without corruption.
 *
 * @param {string} tenantId
 * @param {object} [options]
 * @param {object} [options.tx]
 * @param {string} [options.authorizedTenantId]
 * @returns {Promise<object>} Evaluated subscription state
 */
export async function evaluateTenantSubscriptionStatus(tenantId, options = {}) {
  const { tx = defaultPrisma, authorizedTenantId } = options;
  assertTenantAuthorization(tenantId, authorizedTenantId);

  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true },
  });

  if (!tenant) {
    const error = new Error('Tenant not found');
    error.statusCode = 404;
    throw error;
  }

  const subscription = await getActiveSubscription(tenantId, { tx });

  return {
    tenantStatus: tenant.status,
    isTenantSuspended: tenant.status === 'SUSPENDED',
    subscription: subscription ? toTenantSubscriptionDto(subscription) : null,
    isReadOnly: subscription?.status === SUBSCRIPTION_STATUS.READ_ONLY,
    isGracePeriod: subscription?.status === SUBSCRIPTION_STATUS.GRACE_PERIOD,
    isActiveOrTrial:
      subscription?.status === SUBSCRIPTION_STATUS.ACTIVE ||
      subscription?.status === SUBSCRIPTION_STATUS.TRIAL,
    isSubscriptionSuspended: subscription?.status === SUBSCRIPTION_STATUS.SUSPENDED,
  };
}
