import { Router } from 'express';
import { authenticate, requireStoreOwner } from '../middleware/auth.js';
import { successResponse } from '../utils/apiResponse.js';

const router = Router();

// Enforce authentication and Store Owner membership authorization across all /api/owner routes
router.use(authenticate);
router.use(requireStoreOwner);

/**
 * GET /api/owner/overview
 * Returns Store Owner operations context and active tenant details
 */
router.get('/overview', (req, res) => {
  return res.status(200).json(
    successResponse(
      {
        tenant: req.currentTenant
          ? {
              id: req.currentTenant.id,
              slug: req.currentTenant.slug,
              legalName: req.currentTenant.legalName,
              tradeName: req.currentTenant.tradeName,
              status: req.currentTenant.status,
            }
          : null,
        membership: {
          id: req.currentMembership.id,
          role: req.currentMembership.role,
          status: req.currentMembership.status,
        },
        user: {
          id: req.user.id,
          fullName: req.user.fullName,
          phone: req.user.phone,
          email: req.user.email,
        },
      },
      'Store operations overview retrieved'
    )
  );
});

/**
 * GET /api/owner/membership
 * Returns validated tenant membership status
 */
router.get('/membership', (req, res) => {
  return res.status(200).json(
    successResponse(
      {
        membership: {
          id: req.currentMembership.id,
          role: req.currentMembership.role,
          status: req.currentMembership.status,
          tenantId: req.currentMembership.tenantId,
        },
        tenant: req.currentTenant,
      },
      'Store membership validated'
    )
  );
});

export default router;
