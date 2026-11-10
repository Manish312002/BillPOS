import { prisma as defaultPrisma } from '../db/client.js';
import {
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  AUDIT_STATUS,
  recordAuditEventSchema,
} from '@billingbuddy/shared';

/**
 * Normalized set of sensitive keys that must be redacted from audit metadata.
 * Checked against key.toLowerCase().replace(/[-_]/g, '')
 */
const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'rawtoken',
  'tokenhash',
  'sessiontoken',
  'sessiontokenhash',
  'invitationtoken',
  'activationtoken',
  'refreshtoken',
  'accesstoken',
  'secret',
  'secretencrypted',
  'totpsecret',
  'otp',
  'otpdigest',
  'recoverycode',
  'recoverycodes',
  'recoverycodehashes',
  'authorization',
  'authorizationheader',
  'cookie',
  'setcookie',
  'bbsession',
  'csrftoken',
  'csrf',
  'apikey',
  'privatekey',
  'secretkey',
  'clientsecret',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
  'accountnumber',
  'credentials',
  'bearer',
  'jwt',
  'auth',
]);

/**
 * Determines whether a metadata key name represents sensitive material.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const normalized = key.toLowerCase().replace(/[-_]/g, '');

  if (SENSITIVE_KEY_NAMES.has(normalized)) {
    return true;
  }

  // Substring checks for compound credentials (e.g. userPassword, adminSecretKey, clientAuth)
  // Non-sensitive identifiers ending in "id" (e.g. "invitationId", "userId", "tokenId", "authId") are preserved.
  if (
    normalized.includes('password') ||
    normalized.includes('totpsecret') ||
    normalized.includes('secretkey') ||
    normalized.includes('recoverycode') ||
    normalized.includes('tokenhash') ||
    normalized.includes('credential') ||
    normalized.includes('authorizationheader') ||
    (normalized.includes('token') && !normalized.endsWith('id')) ||
    (normalized.includes('bearer') && !normalized.endsWith('id')) ||
    (normalized.includes('jwt') && !normalized.endsWith('id')) ||
    (normalized.includes('auth') && !normalized.endsWith('id'))
  ) {
    return true;
  }

  return false;
}

/**
 * Recursively deep-clones and sanitizes metadata, replacing sensitive fields
 * with "[REDACTED]". Handles nested objects, arrays, and circular references.
 *
 * @param {*} data
 * @param {WeakSet} [seen]
 * @returns {*} Sanitized metadata
 */
export function sanitizeAuditMetadata(data, seen = new WeakSet()) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  // Guard against circular references
  if (seen.has(data)) {
    return '[CIRCULAR]';
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditMetadata(item, seen));
  }

  // Handle Date instances
  if (data instanceof Date) {
    return data.toISOString();
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeAuditMetadata(value, seen);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Centralized audit event recording service.
 *
 * Guarantees:
 * - Uses existing Prisma transaction `tx` if supplied to preserve atomicity with mutations.
 * - Extracts request context (IP, User-Agent, RequestId, Actor, Tenant) safely.
 * - Recursively redacts all sensitive secrets and tokens from metadata.
 * - Validates and normalizes audit event structure.
 * - Fails explicitly on write errors (does not silently swallow exceptions).
 *
 * @param {Object} params
 * @param {Object} [params.tx] - Optional Prisma transaction client
 * @param {string} [params.actorUserId] - ID of the acting user
 * @param {Object} [params.actorUser] - User entity (fallback for actorUserId)
 * @param {string} [params.actorRole] - Role of the actor (SUPERADMIN, STORE_OWNER, etc.)
 * @param {string} [params.targetTenantId] - Target Tenant ID
 * @param {string} params.module - Audit module (AUTH, TENANT, etc.)
 * @param {string} params.eventType - Canonical event type
 * @param {string} params.action - Specific action performed
 * @param {string} [params.status='SUCCESS'] - Status (SUCCESS, FAILURE, DENIED)
 * @param {string} [params.resourceType] - Type of affected resource (e.g. TENANT, USER)
 * @param {string} [params.resourceId] - ID of affected resource
 * @param {Object} [params.metadata] - Structured, allowlisted metadata diff or operational payload. Raw, untrusted request bodies must NOT be passed directly as metadata. Note: Secret sanitization operates on field key names; arbitrary unstructured free-text secret scanning inside arbitrary string values is not supported.
 * @param {string} [params.supportSessionId] - Optional support session reference
 * @param {string} [params.requestId] - Correlation or request ID
 * @param {string} [params.ipAddress] - Request IP address
 * @param {string} [params.userAgent] - Request User-Agent
 * @param {Object} [params.req] - Express request object for automatic context extraction
 * @returns {Promise<Object>} The persisted AuditLog record
 */
export async function recordAuditEvent({
  tx,
  actorUserId,
  actorUser,
  actorRole,
  targetTenantId,
  module,
  eventType,
  action,
  status = AUDIT_STATUS.SUCCESS,
  resourceType,
  resourceId,
  metadata,
  supportSessionId,
  requestId,
  ipAddress,
  userAgent,
  req,
} = {}) {
  const db = tx || defaultPrisma;

  // 1. Context extraction from Express request if supplied
  let resolvedIp = ipAddress || null;
  let resolvedUserAgent = userAgent || null;
  let resolvedRequestId = requestId || null;
  let resolvedActorUserId =
    actorUserId !== undefined
      ? actorUserId
      : actorUser?.id !== undefined
        ? actorUser.id
        : undefined;
  let resolvedActorRole = actorRole;
  let resolvedTargetTenantId = targetTenantId;

  if (req) {
    if (!resolvedIp) {
      resolvedIp = req.ip || req.headers?.['x-forwarded-for'] || null;
    }
    if (!resolvedUserAgent) {
      resolvedUserAgent = req.headers?.['user-agent'] || null;
    }
    if (!resolvedRequestId) {
      resolvedRequestId = req.headers?.['x-request-id'] || req.id || null;
    }
    if (resolvedActorUserId === undefined) {
      resolvedActorUserId = req.user?.id || req.session?.userId || null;
    }
    if (resolvedActorRole === undefined) {
      resolvedActorRole =
        req.platformRole || req.currentMembership?.role || req.user?.platformAuthorization?.role || null;
    }
    if (resolvedTargetTenantId === undefined) {
      resolvedTargetTenantId =
        req.currentMembership?.tenantId || req.session?.activeTenantId || req.params?.tenantId || null;
    }
  }

  resolvedActorUserId = resolvedActorUserId || null;
  resolvedActorRole = resolvedActorRole || null;
  resolvedTargetTenantId = resolvedTargetTenantId || null;

  // 2. Normalize and sanitize metadata
  const sanitizedMetadata = metadata ? sanitizeAuditMetadata(metadata) : null;

  // 3. Normalize values and validate mandatory fields
  if (!module || typeof module !== 'string' || !module.trim()) {
    throw new Error('Audit module is required');
  }
  if (!eventType || typeof eventType !== 'string' || !eventType.trim()) {
    throw new Error('Audit eventType is required');
  }
  if (!action || typeof action !== 'string' || !action.trim()) {
    throw new Error('Audit action is required');
  }

  const normalizedModule = module.trim().toUpperCase();
  const normalizedEventType = eventType.trim().toUpperCase();
  const normalizedAction = action.trim().toUpperCase();
  const normalizedStatus = (status || AUDIT_STATUS.SUCCESS).trim().toUpperCase();

  // 4. Validate payload with shared contract
  const validatedPayload = recordAuditEventSchema.parse({
    actorUserId: resolvedActorUserId,
    actorRole: resolvedActorRole,
    targetTenantId: resolvedTargetTenantId,
    module: normalizedModule,
    eventType: normalizedEventType,
    action: normalizedAction,
    status: normalizedStatus,
    resourceType: resourceType || null,
    resourceId: resourceId || null,
    metadata: sanitizedMetadata,
    supportSessionId: supportSessionId || null,
    requestId: resolvedRequestId,
    ipAddress: resolvedIp,
    userAgent: resolvedUserAgent,
  });

  // 5. Atomic write using provided transaction or default client
  const auditRecord = await db.auditLog.create({
    data: {
      actorUserId: validatedPayload.actorUserId,
      actorRole: validatedPayload.actorRole,
      targetTenantId: validatedPayload.targetTenantId,
      module: validatedPayload.module,
      eventType: validatedPayload.eventType,
      action: validatedPayload.action,
      status: validatedPayload.status,
      resourceType: validatedPayload.resourceType,
      resourceId: validatedPayload.resourceId,
      metadata: validatedPayload.metadata,
      supportSessionId: validatedPayload.supportSessionId,
      requestId: validatedPayload.requestId,
      ipAddress: validatedPayload.ipAddress,
      userAgent: validatedPayload.userAgent,
    },
  });

  return auditRecord;
}

/**
 * Safely records a standalone security rejection audit event outside of transactions.
 * If database persistence fails, it catches the error and logs a strictly allowlisted
 * operational error log according to ADR-010 (SEC-ADR-04), preserving the original
 * security rejection flow without throwing an unhandled database exception.
 */
export async function recordSecurityRejectionAuditSafe({
  action,
  reason,
  resourceType = 'SESSION',
  resourceId = null,
  actorUserId = null,
  actorRole = null,
  targetTenantId = null,
  metadata = {},
  ipAddress = null,
  userAgent = null,
  req = null,
} = {}) {
  try {
    return await recordAuditEvent({
      actorUserId,
      actorRole,
      targetTenantId,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action,
      status: AUDIT_STATUS.FAILURE,
      resourceType,
      resourceId,
      metadata: {
        ...metadata,
        ...(reason ? { reason } : {}),
      },
      ipAddress,
      userAgent,
      req,
    });
  } catch (auditErr) {
    if (process.env.NODE_ENV !== 'test') {
      const safeErrorCode =
        typeof auditErr?.code === 'string' && /^[A-Za-z0-9_]+$/.test(auditErr.code)
          ? auditErr.code
          : 'DATABASE_WRITE_ERROR';
      const correlationId =
        req?.id || req?.headers?.['x-request-id'] || req?.headers?.['x-correlation-id'] || null;

      console.error(
        '[AUDIT_PERSISTENCE_FAILED]',
        JSON.stringify({
          action: action || 'UNKNOWN_ACTION',
          failureCategory: 'AUDIT_WRITE_FAILURE',
          requestId: typeof correlationId === 'string' ? correlationId.slice(0, 64) : null,
          timestamp: new Date().toISOString(),
          errorClass: auditErr?.name || 'Error',
          errorCode: safeErrorCode,
          diagnosticContext: {
            reason: reason || 'UNKNOWN_REASON',
            resourceType: resourceType || null,
          },
        })
      );
    }
    return null;
  }
}

export default {
  recordAuditEvent,
  recordSecurityRejectionAuditSafe,
  sanitizeAuditMetadata,
  isSensitiveKey,
};
