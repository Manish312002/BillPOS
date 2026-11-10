import { Router } from 'express';
import { z } from 'zod';
import {
  createTenantSchema,
  tenantIdParamSchema,
  suspendTenantSchema,
  reactivateTenantSchema,
} from '@billingbuddy/shared';
import * as tenantService from '../services/tenant.service.js';
import {
  authenticate,
  requireSuperadmin,
  requireSecondFactorComplete,
  requireRecoveryCodeAckComplete,
  requirePasswordChangeComplete,
} from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { successResponse } from '../utils/apiResponse.js';

const router = Router();

// Enforce mandatory security middleware pipeline for all platform management routes
router.use(authenticate);
router.use(requireSecondFactorComplete);
router.use(requireRecoveryCodeAckComplete);
router.use(requirePasswordChangeComplete);
router.use(requireSuperadmin);

// Validation schemas for query and path parameters
const listTenantsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: 'Page must be an integer' })
    .min(1, { message: 'Page must be greater than or equal to 1' })
    .default(1),
  limit: z.coerce
    .number()
    .int({ message: 'Limit must be an integer' })
    .min(1, { message: 'Limit must be greater than or equal to 1' })
    .max(50, { message: 'Limit cannot exceed 50' })
    .default(20),
  search: z.string().trim().optional(),
  status: z
    .enum(['INVITED', 'ACTIVE', 'SUSPENDED'], {
      errorMap: () => ({ message: 'Status must be one of: INVITED, ACTIVE, SUSPENDED' }),
    })
    .optional(),
});

/**
 * GET /api/platform/tenants
 *
 * Retrieves a paginated list of Tenants with deterministic sorting and secret-free serializers.
 */
router.get('/tenants', async (req, res, next) => {
  try {
    const validated = listTenantsQuerySchema.parse(req.query);

    const result = await tenantService.listTenants({
      page: validated.page,
      limit: validated.limit,
      search: validated.search,
      status: validated.status,
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    });

    return res
      .status(200)
      .json(successResponse(result, 'Tenants retrieved successfully', result.pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/platform/tenants/:tenantId
 *
 * Retrieves complete tenant details, onboarding progress, and invitation history.
 */
router.get('/tenants/:tenantId', async (req, res, next) => {
  try {
    const validated = tenantIdParamSchema.parse(req.params);

    const result = await tenantService.getTenantById(validated.tenantId);

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    });

    return res.status(200).json(successResponse(result, 'Tenant retrieved successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/platform/tenants
 *
 * Provisions a new Tenant, initializes store onboarding progress, generates a 12-hour
 * single-use Store Owner invitation, and returns the ephemeral activation link & WhatsApp URL.
 *
 * Middleware pipeline order:
 * 1. authenticate (router-level)
 * 2. requireSecondFactorComplete (router-level)
 * 3. requirePasswordChangeComplete (router-level)
 * 4. requireSuperadmin (router-level)
 * 5. csrfProtection (route-level)
 * 6. Zod validation & controller
 */
router.post('/tenants', csrfProtection, async (req, res, next) => {
  try {
    const validated = createTenantSchema.parse(req.body);

    const result = await tenantService.createTenant({
      legalName: validated.legalName,
      tradeName: validated.tradeName,
      slug: validated.slug,
      ownerFullName: validated.ownerFullName,
      ownerPhone: validated.ownerPhone,
      ownerEmail: validated.ownerEmail,
      actorUserId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });

    return res
      .status(201)
      .json(
        successResponse(result, 'Tenant created and Store Owner invitation generated successfully')
      );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/platform/tenants/:tenantId/invitations/resend
 *
 * Reissues a Store Owner invitation for an existing tenant, invalidating/superseding
 * any prior pending invitations, and returns fresh ephemeral activation & WhatsApp links.
 */
router.post('/tenants/:tenantId/invitations/resend', csrfProtection, async (req, res, next) => {
  try {
    const validated = tenantIdParamSchema.parse(req.params);

    const result = await tenantService.resendInvitation({
      tenantId: validated.tenantId,
      actorUserId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });

    return res
      .status(200)
      .json(successResponse(result, 'Store Owner invitation reissued successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/platform/tenants/:tenantId/suspend
 *
 * Suspends an active tenant, immediately revoking active tenant sessions.
 */
router.post('/tenants/:tenantId/suspend', csrfProtection, async (req, res, next) => {
  try {
    const params = tenantIdParamSchema.parse(req.params);
    const body = suspendTenantSchema.parse(req.body || {});

    const result = await tenantService.suspendTenant({
      tenantId: params.tenantId,
      reason: body.reason,
      actorUserId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });

    return res.status(200).json(successResponse(result, 'Tenant suspended successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/platform/tenants/:tenantId/reactivate
 *
 * Reactivates a suspended tenant.
 */
router.post('/tenants/:tenantId/reactivate', csrfProtection, async (req, res, next) => {
  try {
    const params = tenantIdParamSchema.parse(req.params);
    const body = reactivateTenantSchema.parse(req.body || {});

    const result = await tenantService.reactivateTenant({
      tenantId: params.tenantId,
      reason: body.reason,
      actorUserId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });

    return res.status(200).json(successResponse(result, 'Tenant reactivated successfully'));
  } catch (err) {
    next(err);
  }
});

export default router;
