import { prisma as defaultPrisma } from '../db/client.js';
import {
  getActiveSubscription,
  lockActiveSubscription,
  assertTenantAuthorization,
} from './subscription.service.js';
import {
  SUBSCRIPTION_STATUS,
  FEATURE_KEYS,
  FEATURE_VALUE_TYPE,
  SUBSCRIPTION_ERROR_CODES,
  ERROR_CODES,
} from '@billingbuddy/shared';

/**
 * Provides upgrade recommendations based on current plan and exhausted feature.
 *
 * @param {string} [currentPlanCode]
 * @param {string} featureKey
 * @returns {object} Actionable upgrade advice
 */
export function getUpgradeGuidance(currentPlanCode, featureKey) {
  switch (currentPlanCode) {
    case 'TRIAL_14':
    case 'STARTER':
      return {
        suggestedPlan: 'GROWTH',
        message: `Upgrade to Growth tier to increase ${featureKey} capacity.`,
      };
    case 'GROWTH':
      return {
        suggestedPlan: 'ENTERPRISE',
        message: `Upgrade to Enterprise tier for unlimited or custom ${featureKey} capacity.`,
      };
    case 'ENTERPRISE':
      return {
        suggestedPlan: 'CUSTOM_ENTERPRISE',
        message: `Contact BillingBuddy support for custom quota overrides on ${featureKey}.`,
      };
    default:
      return {
        suggestedPlan: 'GROWTH',
        message: `Upgrade your subscription plan to increase ${featureKey} limits.`,
      };
  }
}

/**
 * Resolves authoritative entitlements for a tenant by combining:
 * 1. Active subscription plan features
 * 2. Active TenantEntitlementOverride entries (respecting expiresAt and tenant boundary)
 * 3. Tenant platform status (SUSPENDED blocks all)
 * 4. Subscription lifecycle status (READ_ONLY blocks mutation, SUSPENDED blocks commercial access)
 *
 * Missing or unknown feature keys are denied by default.
 * Values of -1 represent UNLIMITED quotas.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {object} [options]
 * @param {object} [options.tx] - Optional Prisma transaction client
 * @param {string} [options.authorizedTenantId] - Calling tenant authorization context
 * @param {Date} [options.now] - Current timestamp (default: new Date())
 * @returns {Promise<object>} Structured entitlement resolution
 */
export async function resolveTenantEntitlements(tenantId, options = {}) {
  const {
    tx = defaultPrisma,
    authorizedTenantId,
    now = new Date(),
  } = options;

  assertTenantAuthorization(tenantId, authorizedTenantId);

  // 1. Verify tenant exists and check platform status
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true, slug: true, legalName: true },
  });

  if (!tenant) {
    const error = new Error('Tenant not found');
    error.code = ERROR_CODES.NOT_FOUND;
    error.statusCode = 404;
    throw error;
  }

  const isTenantSuspended = tenant.status === 'SUSPENDED';

  // 2. Fetch current active subscription (governed by partial unique index)
  const subscription = await getActiveSubscription(tenantId, { tx, includeRelations: true });

  // 3. Fetch active entitlement overrides for this tenant
  // Strict tenant isolation: where: { tenantId } prevents foreign overrides from ever applying
  const activeOverrides = await tx.tenantEntitlementOverride.findMany({
    where: {
      tenantId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
  });

  // 4. Resolve features: Plan Features as baseline
  const features = {};

  if (subscription?.plan?.features) {
    for (const pf of subscription.plan.features) {
      features[pf.featureKey] = {
        featureKey: pf.featureKey,
        valueType: pf.valueType,
        effectiveValue:
          pf.valueType === FEATURE_VALUE_TYPE.BOOLEAN
            ? Boolean(pf.booleanValue)
            : pf.numericValue,
        isUnlimited:
          pf.valueType === FEATURE_VALUE_TYPE.NUMERIC && pf.numericValue === -1,
        source: 'PLAN',
        planCode: subscription.plan.code,
      };
    }
  }

  // 5. Apply active overrides with higher precedence
  for (const ov of activeOverrides) {
    features[ov.featureKey] = {
      featureKey: ov.featureKey,
      valueType: ov.valueType,
      effectiveValue:
        ov.valueType === FEATURE_VALUE_TYPE.BOOLEAN
          ? Boolean(ov.booleanValue)
          : ov.numericValue,
      isUnlimited:
        ov.valueType === FEATURE_VALUE_TYPE.NUMERIC && ov.numericValue === -1,
      source: 'OVERRIDE',
      overrideId: ov.id,
      reason: ov.reason,
      expiresAt: ov.expiresAt ? ov.expiresAt.toISOString() : null,
    };
  }

  // 6. Evaluate lifecycle access gates
  const subStatus = subscription ? subscription.status : null;
  const isReadOnly = subStatus === SUBSCRIPTION_STATUS.READ_ONLY;
  const isGracePeriod = subStatus === SUBSCRIPTION_STATUS.GRACE_PERIOD;
  const isSubscriptionSuspended = subStatus === SUBSCRIPTION_STATUS.SUSPENDED;
  const isSubscriptionActive =
    subStatus === SUBSCRIPTION_STATUS.ACTIVE || subStatus === SUBSCRIPTION_STATUS.TRIAL;
  const isSubscriptionInactive =
    !subStatus ||
    subStatus === SUBSCRIPTION_STATUS.CANCELED ||
    subStatus === SUBSCRIPTION_STATUS.EXPIRED;

  // A tenant can perform mutations only if:
  // - Tenant is NOT suspended (legal/platform compliance hold)
  // - Subscription is NOT suspended
  // - Subscription is NOT in READ_ONLY mode
  // - Subscription is NOT inactive/canceled/expired
  const canMutate =
    !isTenantSuspended &&
    !isSubscriptionSuspended &&
    !isReadOnly &&
    !isSubscriptionInactive;

  // Read access is permitted in READ_ONLY, but blocked if tenant or subscription is suspended or inactive
  const canRead = !isTenantSuspended && !isSubscriptionSuspended && !isSubscriptionInactive;

  return {
    tenantId,
    tenantStatus: tenant.status,
    isTenantSuspended,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          planCode: subscription.plan?.code || null,
          billingCycle: subscription.billingCycle,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
          gracePeriodEndsAt: subscription.gracePeriodEndsAt,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          isReadOnly,
          isGracePeriod,
          isSuspended: isSubscriptionSuspended,
          isActive: isSubscriptionActive,
        }
      : null,
    lifecycle: {
      canMutate,
      canRead,
      inGrace: isGracePeriod,
      gracePeriodEndsAt: subscription?.gracePeriodEndsAt || null,
      isReadOnly,
      isTenantSuspended,
      isSubscriptionSuspended,
      isSubscriptionInactive,
    },
    features,
    resolvedAt: now.toISOString(),
  };
}

/**
 * Checks whether a tenant can access a specific feature.
 * Unknown features are denied by default.
 *
 * @param {string} tenantId
 * @param {string} featureKey
 * @param {object} [options]
 * @returns {Promise<object>} Access check result
 */
export async function canAccessFeature(tenantId, featureKey, options = {}) {
  const resolved = await resolveTenantEntitlements(tenantId, options);

  // 1. Tenant platform suspension blocks all access unconditionally
  if (resolved.isTenantSuspended) {
    return {
      hasAccess: false,
      reason: 'Tenant account is administratively suspended',
      code: SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED,
      featureKey,
      effectiveValue: null,
      source: null,
    };
  }

  // 2. Commercial subscription suspension
  if (resolved.lifecycle.isSubscriptionSuspended) {
    return {
      hasAccess: false,
      reason: 'Tenant subscription is suspended',
      code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_SUSPENDED,
      featureKey,
      effectiveValue: null,
      source: null,
    };
  }

  // 3. Inactive or missing subscription
  if (resolved.lifecycle.isSubscriptionInactive) {
    return {
      hasAccess: false,
      reason: 'No active or trial subscription found for tenant',
      code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_INACTIVE,
      featureKey,
      effectiveValue: null,
      source: null,
    };
  }

  // 4. Feature key lookup (missing keys denied by default)
  const feature = resolved.features[featureKey];
  if (!feature) {
    return {
      hasAccess: false,
      reason: `Feature "${featureKey}" is not included in current subscription plan`,
      code: SUBSCRIPTION_ERROR_CODES.FEATURE_NOT_INCLUDED,
      featureKey,
      effectiveValue: null,
      source: 'DEFAULT',
    };
  }

  // 5. Value type evaluation
  if (feature.valueType === FEATURE_VALUE_TYPE.BOOLEAN) {
    const hasAccess = Boolean(feature.effectiveValue);
    return {
      hasAccess,
      reason: hasAccess ? null : `Feature "${featureKey}" is disabled in current plan`,
      code: hasAccess ? null : SUBSCRIPTION_ERROR_CODES.FEATURE_DISABLED,
      featureKey,
      effectiveValue: feature.effectiveValue,
      source: feature.source,
    };
  }

  if (feature.valueType === FEATURE_VALUE_TYPE.NUMERIC) {
    const isUnlimited = feature.isUnlimited;
    const limit = feature.effectiveValue;
    const hasAccess = isUnlimited || limit > 0;
    return {
      hasAccess,
      reason: hasAccess ? null : `Quota for "${featureKey}" is zero`,
      code: hasAccess ? null : SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED,
      featureKey,
      effectiveValue: limit,
      isUnlimited,
      source: feature.source,
    };
  }

  return {
    hasAccess: true,
    reason: null,
    code: null,
    featureKey,
    effectiveValue: feature.effectiveValue,
    source: feature.source,
  };
}

/**
 * Asserts feature access for a tenant. Throws 403 error if access is not permitted.
 *
 * @param {string} tenantId
 * @param {string} featureKey
 * @param {object} [options]
 * @returns {Promise<object>} Resolved feature details
 * @throws {Error} if access is denied
 */
export async function assertFeatureAccess(tenantId, featureKey, options = {}) {
  const result = await canAccessFeature(tenantId, featureKey, options);

  if (!result.hasAccess) {
    const error = new Error(result.reason);
    error.code = result.code || SUBSCRIPTION_ERROR_CODES.FEATURE_NOT_INCLUDED;
    error.statusCode = 403;
    error.details = {
      featureKey,
      source: result.source,
      upgradeGuidance: getUpgradeGuidance(null, featureKey),
    };
    throw error;
  }

  return result;
}

/**
 * Retrieves the effective numeric limit for a quota-controlled feature.
 * Supports -1 as unlimited. Defaults missing features to 0.
 *
 * @param {string} tenantId
 * @param {string} featureKey
 * @param {object} [options]
 * @returns {Promise<object>} Limit specification
 */
export async function getFeatureLimit(tenantId, featureKey, options = {}) {
  const resolved = await resolveTenantEntitlements(tenantId, options);
  const feature = resolved.features[featureKey];

  if (!feature) {
    return {
      featureKey,
      limit: 0,
      isUnlimited: false,
      source: 'DEFAULT',
    };
  }

  if (feature.isUnlimited || feature.effectiveValue === -1) {
    return {
      featureKey,
      limit: -1,
      isUnlimited: true,
      source: feature.source,
    };
  }

  return {
    featureKey,
    limit: Number(feature.effectiveValue) || 0,
    isUnlimited: false,
    source: feature.source,
  };
}

/**
 * Counts authoritative active resources across the four approved quota categories.
 * Filters out soft-deleted and inactive records.
 *
 * @param {string} tenantId
 * @param {object} [options]
 * @param {object} [options.tx] - Prisma transaction client
 * @param {string} [options.authorizedTenantId]
 * @param {object} [options.resourceCounts] - Optional explicit counts for models outside current schema
 * @returns {Promise<object>} Usage counts by feature key
 */
export async function getTenantUsage(tenantId, options = {}) {
  const { tx = defaultPrisma, authorizedTenantId, resourceCounts = {} } = options;
  assertTenantAuthorization(tenantId, authorizedTenantId);

  // 1. Authoritative active users count from TenantMembership (excluding INACTIVE)
  const usersCount =
    resourceCounts[FEATURE_KEYS.MAX_USERS] !== undefined
      ? resourceCounts[FEATURE_KEYS.MAX_USERS]
      : await tx.tenantMembership.count({
          where: { tenantId, status: 'ACTIVE' },
        });

  // 2. Authoritative active outlets count
  // If Outlet table exists in database delegate, count directly; otherwise check UsageRecord or caller count
  let outletsCount = 0;
  if (resourceCounts[FEATURE_KEYS.MAX_OUTLETS] !== undefined) {
    outletsCount = resourceCounts[FEATURE_KEYS.MAX_OUTLETS];
  } else if (tx.outlet) {
    outletsCount = await tx.outlet.count({
      where: {
        tenantId,
        ...(tx.outlet.fields?.deletedAt ? { deletedAt: null } : {}),
        ...(tx.outlet.fields?.status ? { status: { not: 'INACTIVE' } } : {}),
      },
    });
  } else {
    const latest = await tx.usageRecord.findFirst({
      where: { tenantId, metric: FEATURE_KEYS.MAX_OUTLETS },
      orderBy: { recordedAt: 'desc' },
    });
    outletsCount = latest ? latest.recordedCount : 0;
  }

  // 3. Authoritative active devices count
  let devicesCount = 0;
  if (resourceCounts[FEATURE_KEYS.MAX_DEVICES] !== undefined) {
    devicesCount = resourceCounts[FEATURE_KEYS.MAX_DEVICES];
  } else if (tx.posDevice) {
    devicesCount = await tx.posDevice.count({
      where: {
        tenantId,
        ...(tx.posDevice.fields?.status ? { status: 'ACTIVE' } : {}),
      },
    });
  } else {
    const latest = await tx.usageRecord.findFirst({
      where: { tenantId, metric: FEATURE_KEYS.MAX_DEVICES },
      orderBy: { recordedAt: 'desc' },
    });
    devicesCount = latest ? latest.recordedCount : 0;
  }

  // 4. Authoritative active products count
  let productsCount = 0;
  if (resourceCounts[FEATURE_KEYS.MAX_PRODUCTS] !== undefined) {
    productsCount = resourceCounts[FEATURE_KEYS.MAX_PRODUCTS];
  } else if (tx.product) {
    productsCount = await tx.product.count({
      where: {
        tenantId,
        ...(tx.product.fields?.deletedAt ? { deletedAt: null } : {}),
        ...(tx.product.fields?.isActive ? { isActive: true } : {}),
      },
    });
  } else {
    const latest = await tx.usageRecord.findFirst({
      where: { tenantId, metric: FEATURE_KEYS.MAX_PRODUCTS },
      orderBy: { recordedAt: 'desc' },
    });
    productsCount = latest ? latest.recordedCount : 0;
  }

  return {
    [FEATURE_KEYS.MAX_USERS]: usersCount,
    [FEATURE_KEYS.MAX_OUTLETS]: outletsCount,
    [FEATURE_KEYS.MAX_DEVICES]: devicesCount,
    [FEATURE_KEYS.MAX_PRODUCTS]: productsCount,
  };
}

/**
 * Transaction-aware atomic quota assertion.
 *
 * Implements Finding 6 & Decision D-06:
 * 1. Acquires exclusive row-level lock on TenantSubscription using SELECT ... FOR UPDATE.
 * 2. Checks tenant suspension and subscription lifecycle (blocks READ_ONLY and SUSPENDED).
 * 3. Resolves effective quota limit (evaluating overrides before plan limits).
 * 4. Checks current active usage within the same database transaction.
 * 5. Rejects quota exhaustion with 403 QUOTA_EXCEEDED and actionable upgrade guidance.
 *
 * @param {string} tenantId
 * @param {string} featureKey - e.g. "max_outlets", "max_users", "max_devices", "max_products"
 * @param {object} options
 * @param {object} options.tx - Prisma transaction client (REQUIRED for row-locking)
 * @param {number} [options.additionalCount=1] - Number of slots requested
 * @param {number} [options.currentUsage] - Explicit count override if known
 * @param {string} [options.authorizedTenantId]
 * @param {string} [options.actorRole]
 * @returns {Promise<object>} Quota availability result
 * @throws {Error} 403 QUOTA_EXCEEDED if limit would be breached
 */
export async function assertQuotaAvailable(tenantId, featureKey, options = {}) {
  const {
    tx,
    additionalCount = 1,
    currentUsage: explicitUsage,
    authorizedTenantId,
    actorRole,
  } = options;

  if (!tx) {
    const error = new Error('Database transaction client (tx) is required for atomic quota enforcement');
    error.statusCode = 500;
    throw error;
  }

  assertTenantAuthorization(tenantId, authorizedTenantId);

  // 1. Pessimistic Row Lock on TenantSubscription (Finding 6)
  // Serializes competing concurrent requests targeting the same tenant subscription
  await lockActiveSubscription(tenantId, tx);

  // 2. Resolve entitlements & verify subscription status within transaction
  const resolved = await resolveTenantEntitlements(tenantId, {
    tx,
    authorizedTenantId,
    actorRole,
  });

  // 3. Verify platform compliance and lifecycle
  if (resolved.isTenantSuspended) {
    const error = new Error('Tenant is administratively suspended');
    error.code = SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED;
    error.statusCode = 403;
    throw error;
  }

  if (resolved.lifecycle.isSubscriptionSuspended) {
    const error = new Error('Subscription is suspended');
    error.code = SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_SUSPENDED;
    error.statusCode = 403;
    throw error;
  }

  if (resolved.lifecycle.isSubscriptionInactive) {
    const error = new Error('No active subscription found');
    error.code = SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_INACTIVE;
    error.statusCode = 403;
    throw error;
  }

  if (resolved.lifecycle.isReadOnly) {
    const error = new Error('Cannot create new resources: subscription is in read-only mode');
    error.code = SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_READ_ONLY;
    error.statusCode = 403;
    throw error;
  }

  // 4. Resolve Limit
  const limitInfo = await getFeatureLimit(tenantId, featureKey, {
    tx,
    authorizedTenantId,
    actorRole,
  });

  // 5. Unlimited quota bypass (-1)
  if (limitInfo.isUnlimited) {
    return {
      allowed: true,
      featureKey,
      limit: -1,
      isUnlimited: true,
      currentUsage: 0,
      requested: additionalCount,
      remaining: Infinity,
      source: limitInfo.source,
    };
  }

  // 6. Authoritative active resource count
  let currentCount;
  if (explicitUsage !== undefined) {
    currentCount = explicitUsage;
  } else {
    const usage = await getTenantUsage(tenantId, {
      tx,
      authorizedTenantId,
    });
    currentCount = usage[featureKey] || 0;
  }

  // 7. Enforce Quota Boundary
  if (currentCount + additionalCount > limitInfo.limit) {
    const error = new Error(
      `Resource quota exceeded for ${featureKey}. Limit: ${limitInfo.limit}, Current: ${currentCount}, Requested: ${additionalCount}.`
    );
    error.code = SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED;
    error.statusCode = 403;
    error.details = {
      featureKey,
      limit: limitInfo.limit,
      currentUsage: currentCount,
      requested: additionalCount,
      remaining: Math.max(0, limitInfo.limit - currentCount),
      source: limitInfo.source,
      upgradeGuidance: getUpgradeGuidance(resolved.subscription?.planCode, featureKey),
    };
    throw error;
  }

  return {
    allowed: true,
    featureKey,
    limit: limitInfo.limit,
    isUnlimited: false,
    currentUsage: currentCount,
    requested: additionalCount,
    remaining: limitInfo.limit - (currentCount + additionalCount),
    source: limitInfo.source,
  };
}

/**
 * Validates plan downgrade rules (Decision D-05).
 * Blocks downgrade if current active resource usage exceeds target plan limits.
 *
 * @param {string} tenantId
 * @param {string} targetPlanCode - Plan code to evaluate (e.g. "STARTER")
 * @param {object} [options]
 * @returns {Promise<object>} Validation result
 * @throws {Error} 422 DOWNGRADE_VIOLATION if any metric exceeds target plan limit
 */
export async function validatePlanDowngrade(tenantId, targetPlanCode, options = {}) {
  const { tx = defaultPrisma, authorizedTenantId, resourceCounts } = options;
  assertTenantAuthorization(tenantId, authorizedTenantId);

  // 1. Fetch target plan
  const targetPlan = await tx.plan.findUnique({
    where: { code: targetPlanCode },
    include: { features: true },
  });

  if (!targetPlan || !targetPlan.isActive) {
    const error = new Error(`Target plan "${targetPlanCode}" not found or inactive`);
    error.code = ERROR_CODES.NOT_FOUND;
    error.statusCode = 404;
    throw error;
  }

  // 2. Fetch current active usage
  const usage = await getTenantUsage(tenantId, { tx, authorizedTenantId, resourceCounts });

  // 3. Compare each numeric quota feature against target plan limit
  const violations = [];

  for (const pf of targetPlan.features) {
    if (pf.valueType === FEATURE_VALUE_TYPE.NUMERIC && pf.numericValue !== -1) {
      const current = usage[pf.featureKey] || 0;
      if (current > pf.numericValue) {
        violations.push({
          featureKey: pf.featureKey,
          currentUsage: current,
          targetLimit: pf.numericValue,
          excess: current - pf.numericValue,
        });
      }
    }
  }

  if (violations.length > 0) {
    const error = new Error(
      `Cannot downgrade to plan "${targetPlanCode}": current usage exceeds target plan limits.`
    );
    error.code = SUBSCRIPTION_ERROR_CODES.DOWNGRADE_VIOLATION;
    error.statusCode = 422;
    error.details = {
      targetPlanCode,
      violations,
      guidance: 'Delete or deactivate excess resources before downgrading.',
    };
    throw error;
  }

  return {
    valid: true,
    targetPlanCode,
    currentUsage: usage,
  };
}
