import {
  canAccessFeature,
  resolveTenantEntitlements,
  getTenantUsage,
  getFeatureLimit,
} from '../services/entitlement.service.js';
import { SUBSCRIPTION_ERROR_CODES } from '@billingbuddy/shared';

/**
 * Extracts trusted tenantId from authenticated server context.
 * Strict security rule: Never reads tenantId from req.body, req.query, or unverified params.
 *
 * @param {object} req - Express request
 * @returns {string|null} Trusted tenant UUID or null
 */
export function getTrustedTenantId(req) {
  return req.currentMembership?.tenantId || req.session?.activeTenantId || null;
}

/**
 * Middleware factory requiring that the tenant's current subscription enables a specific feature.
 *
 * @param {string} featureKey - e.g. "offline_pos", "advanced_reports"
 * @returns {Function} Express middleware
 */
export function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const tenantId = getTrustedTenantId(req);

      if (!tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.TENANT_CONTEXT_REQUIRED,
            message: 'Authenticated tenant context is required to evaluate feature access',
          },
        });
      }

      const access = await canAccessFeature(tenantId, featureKey, {
        authorizedTenantId: tenantId,
        actorRole: req.currentMembership?.role,
      });

      if (!access.hasAccess) {
        return res.status(403).json({
          success: false,
          error: {
            code: access.code || SUBSCRIPTION_ERROR_CODES.FEATURE_NOT_INCLUDED,
            message: access.reason || `Feature "${featureKey}" is not included in current plan`,
            details: {
              featureKey,
              source: access.source,
            },
          },
        });
      }

      req.featureEntitlement = access;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware factory enforcing subscription lifecycle states:
 * - TRIAL / ACTIVE: Full access.
 * - GRACE_PERIOD: Full access with warning headers.
 * - READ_ONLY: Blocks mutation HTTP methods (POST, PUT, PATCH, DELETE) unless allowReadOnly=true.
 * - SUSPENDED / INACTIVE: Blocks all requests.
 * - TENANT SUSPENDED: Blocks all requests.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowReadOnly=false] - Whether mutating operations are explicitly exempted
 * @returns {Function} Express middleware
 */
export function enforceSubscriptionAccess(options = {}) {
  const { allowReadOnly = false } = options;

  return async (req, res, next) => {
    try {
      const tenantId = getTrustedTenantId(req);

      if (!tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.TENANT_CONTEXT_REQUIRED,
            message: 'Authenticated tenant context is required to evaluate subscription access',
          },
        });
      }

      const entitlements = await resolveTenantEntitlements(tenantId, {
        authorizedTenantId: tenantId,
        actorRole: req.currentMembership?.role,
      });

      // 1. Tenant platform suspension blocks all operations unconditionally
      if (entitlements.isTenantSuspended) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED,
            message: 'Tenant account is administratively suspended',
          },
        });
      }

      // 2. Commercial subscription suspension
      if (entitlements.lifecycle.isSubscriptionSuspended) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_SUSPENDED,
            message: 'Tenant subscription is suspended',
          },
        });
      }

      // 3. Inactive or missing subscription
      if (entitlements.lifecycle.isSubscriptionInactive) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_INACTIVE,
            message: 'No active or trial subscription found for tenant',
          },
        });
      }

      // 4. Grace Period handling: Allow access but attach warning headers
      if (entitlements.lifecycle.inGrace) {
        res.setHeader('X-Subscription-Grace-Period', 'true');
        if (entitlements.lifecycle.gracePeriodEndsAt) {
          res.setHeader(
            'X-Subscription-Grace-Ends-At',
            new Date(entitlements.lifecycle.gracePeriodEndsAt).toISOString()
          );
        }
        req.subscriptionGrace = {
          inGrace: true,
          gracePeriodEndsAt: entitlements.lifecycle.gracePeriodEndsAt,
        };
      }

      // 5. Read-Only mode enforcement
      if (entitlements.lifecycle.isReadOnly) {
        const isSafeReadMethod =
          req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

        if (isSafeReadMethod || allowReadOnly) {
          res.setHeader('X-Subscription-Read-Only', 'true');
          req.isSubscriptionReadOnly = true;
          return next();
        }

        // Mutating method blocked in read-only mode
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_READ_ONLY,
            message:
              'Operation prohibited: subscription is in read-only mode. Please renew your subscription to restore write access.',
            details: {
              method: req.method,
              status: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_READ_ONLY,
            },
          },
        });
      }

      req.tenantEntitlements = entitlements;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convenience middleware requiring write access (blocks READ_ONLY mode).
 * Alias for enforceSubscriptionAccess({ allowReadOnly: false }).
 */
export function requireWriteAccess() {
  return enforceSubscriptionAccess({ allowReadOnly: false });
}

/**
 * Middleware factory performing read-only pre-flight quota checks on incoming requests.
 * Authoritative transactional assertions still execute in the service layer using assertQuotaAvailable.
 *
 * @param {string} featureKey - e.g. "max_outlets", "max_users"
 * @param {number} [count=1] - Requested quantity
 * @returns {Function} Express middleware
 */
export function requireQuota(featureKey, count = 1) {
  return async (req, res, next) => {
    try {
      const tenantId = getTrustedTenantId(req);

      if (!tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.TENANT_CONTEXT_REQUIRED,
            message: 'Authenticated tenant context is required to evaluate quota availability',
          },
        });
      }

      const limitInfo = await getFeatureLimit(tenantId, featureKey, {
        authorizedTenantId: tenantId,
      });

      if (limitInfo.isUnlimited) {
        return next();
      }

      const usage = await getTenantUsage(tenantId, {
        authorizedTenantId: tenantId,
      });

      const current = usage[featureKey] || 0;

      if (current + count > limitInfo.limit) {
        return res.status(403).json({
          success: false,
          error: {
            code: SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED,
            message: `Resource quota exceeded for ${featureKey}. Limit: ${limitInfo.limit}, Current: ${current}`,
            details: {
              featureKey,
              limit: limitInfo.limit,
              currentUsage: current,
              requested: count,
              remaining: Math.max(0, limitInfo.limit - current),
            },
          },
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
