import { z } from 'zod';

/**
 * Standard Audit Event Status Values
 */
export const AUDIT_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DENIED: 'DENIED',
});

/**
 * Standard Audit System Modules
 */
export const AUDIT_MODULES = Object.freeze({
  AUTH: 'AUTH',
  TENANT: 'TENANT',
  BILLING: 'BILLING',
  POS: 'POS',
  SETTINGS: 'SETTINGS',
  SYSTEM: 'SYSTEM',
});

/**
 * Canonical Audit Event Types
 */
export const AUDIT_EVENT_TYPES = Object.freeze({
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_ACTIVATED: 'TENANT_ACTIVATED',
  TENANT_INVITATION_RESENT: 'TENANT_INVITATION_RESENT',
  TENANT_LIFECYCLE: 'TENANT_LIFECYCLE',
  SECURITY_AUTH: 'SECURITY_AUTH',
  SUBSCRIPTION_LIFECYCLE: 'SUBSCRIPTION_LIFECYCLE',
  SUBSCRIPTION_MUTATION: 'SUBSCRIPTION_MUTATION',
  SUBSCRIPTION_PAYMENT: 'SUBSCRIPTION_PAYMENT',
  ENTITLEMENT_OVERRIDE: 'ENTITLEMENT_OVERRIDE',
});

/**
 * Canonical Audit Action Identifiers
 */
export const AUDIT_ACTIONS = Object.freeze({
  SUPERADMIN_LOGIN_SUCCESS: 'SUPERADMIN_LOGIN_SUCCESS',
  SUPERADMIN_LOGIN_FAILED: 'SUPERADMIN_LOGIN_FAILED',
  SUPERADMIN_LOGOUT: 'SUPERADMIN_LOGOUT',
  SUPERADMIN_SESSION_REVOKED: 'SUPERADMIN_SESSION_REVOKED',
  OWNER_LOGIN_SUCCESS: 'OWNER_LOGIN_SUCCESS',
  OWNER_LOGIN_FAILED: 'OWNER_LOGIN_FAILED',
  OWNER_LOGOUT: 'OWNER_LOGOUT',
  OWNER_SESSION_REVOKED: 'OWNER_SESSION_REVOKED',
  SESSION_ROTATED: 'SESSION_ROTATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_VALIDATION_FAILED: 'SESSION_VALIDATION_FAILED',
  TENANT_ACCESS_DENIED: 'TENANT_ACCESS_DENIED',
  CSRF_VALIDATION_FAILED: 'CSRF_VALIDATION_FAILED',
  // Subscription & Entitlements Audit Actions
  SUBSCRIPTION_TRIAL_STARTED: 'SUBSCRIPTION_TRIAL_STARTED',
  SUBSCRIPTION_PAYMENT_SUBMITTED: 'SUBSCRIPTION_PAYMENT_SUBMITTED',
  SUBSCRIPTION_PAYMENT_VERIFIED: 'SUBSCRIPTION_PAYMENT_VERIFIED',
  SUBSCRIPTION_PAYMENT_REJECTED: 'SUBSCRIPTION_PAYMENT_REJECTED',
  SUBSCRIPTION_GRACE_ENTERED: 'SUBSCRIPTION_GRACE_ENTERED',
  SUBSCRIPTION_READ_ONLY_ENTERED: 'SUBSCRIPTION_READ_ONLY_ENTERED',
  SUBSCRIPTION_CANCEL_SCHEDULED: 'SUBSCRIPTION_CANCEL_SCHEDULED',
  SUBSCRIPTION_CANCEL_RESCINDED: 'SUBSCRIPTION_CANCEL_RESCINDED',
  SUBSCRIPTION_CANCELED: 'SUBSCRIPTION_CANCELED',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_REACTIVATED: 'SUBSCRIPTION_REACTIVATED',
  SUBSCRIPTION_PERIOD_EXTENDED: 'SUBSCRIPTION_PERIOD_EXTENDED',
  SUBSCRIPTION_PLAN_ASSIGNED: 'SUBSCRIPTION_PLAN_ASSIGNED',
  SUBSCRIPTION_PLAN_CHANGED: 'SUBSCRIPTION_PLAN_CHANGED',
  SUBSCRIPTION_OVERRIDE_GRANTED: 'SUBSCRIPTION_OVERRIDE_GRANTED',
  SUBSCRIPTION_OVERRIDE_REVOKED: 'SUBSCRIPTION_OVERRIDE_REVOKED',
  SUBSCRIPTION_PLAN_CREATED: 'SUBSCRIPTION_PLAN_CREATED',
  SUBSCRIPTION_PLAN_UPDATED: 'SUBSCRIPTION_PLAN_UPDATED',
  SUBSCRIPTION_DEVICE_PAIRED: 'SUBSCRIPTION_DEVICE_PAIRED',
  SUBSCRIPTION_LEASE_ISSUED: 'SUBSCRIPTION_LEASE_ISSUED',
  SUBSCRIPTION_LEASE_RECOVERED: 'SUBSCRIPTION_LEASE_RECOVERED',
  SUBSCRIPTION_DEVICE_REVOKED: 'SUBSCRIPTION_DEVICE_REVOKED',
});

/**
 * Validation schema for Audit Status
 */
export const auditStatusSchema = z.enum([
  AUDIT_STATUS.SUCCESS,
  AUDIT_STATUS.FAILURE,
  AUDIT_STATUS.DENIED,
]);

/**
 * Validation schema for Audit Module
 */
export const auditModuleSchema = z.enum([
  AUDIT_MODULES.AUTH,
  AUDIT_MODULES.TENANT,
  AUDIT_MODULES.BILLING,
  AUDIT_MODULES.POS,
  AUDIT_MODULES.SETTINGS,
  AUDIT_MODULES.SYSTEM,
]);

/**
 * Structured Before/After mutation difference schema for metadata
 */
export const auditDiffSchema = z
  .object({
    before: z.record(z.any()).optional().nullable(),
    after: z.record(z.any()).optional().nullable(),
  })
  .optional()
  .nullable();

/**
 * Audit Metadata contract with optional diff, reason, and context
 */
export const auditMetadataSchema = z
  .record(z.any())
  .optional()
  .nullable();

/**
 * Full record audit event payload schema
 */
export const recordAuditEventSchema = z.object({
  actorUserId: z.string().uuid({ message: 'Invalid actor user UUID' }).optional().nullable(),
  actorRole: z.string().trim().min(1).optional().nullable(),
  targetTenantId: z.string().uuid({ message: 'Invalid target tenant UUID' }).optional().nullable(),
  module: z
    .string({ required_error: 'Module is required' })
    .trim()
    .min(1, { message: 'Module is required' }),
  eventType: z
    .string({ required_error: 'Event type is required' })
    .trim()
    .min(1, { message: 'Event type is required' }),
  action: z
    .string({ required_error: 'Action is required' })
    .trim()
    .min(1, { message: 'Action is required' }),
  status: auditStatusSchema.default(AUDIT_STATUS.SUCCESS),
  resourceType: z.string().trim().optional().nullable(),
  resourceId: z.string().trim().optional().nullable(),
  metadata: auditMetadataSchema,
  supportSessionId: z.string().trim().optional().nullable(),
  requestId: z.string().trim().optional().nullable(),
  ipAddress: z.string().trim().optional().nullable(),
  userAgent: z.string().trim().optional().nullable(),
});
