import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { generateOpaqueToken, hashToken } from '../utils/security.js';
import {
  generateInvitationMessage,
  generateWhatsAppLink,
  normalizeWhatsAppPhone,
} from '../utils/whatsapp.js';

/**
 * Derives deterministic invitation lifecycle status adhering to ADR-002 precedence:
 * 1. ACCEPTED
 * 2. SUPERSEDED
 * 3. REVOKED
 * 4. EXPIRED (stored as EXPIRED or PENDING with expiresAt <= now)
 * 5. INVITED_PENDING_ACCEPTANCE (stored as PENDING with expiresAt > now)
 *
 * Keeps `isExpired` strictly separate from lifecycle status.
 * Never reports superseded or revoked invitations as merely expired.
 * Excludes all secrets (tokenHash, rawToken).
 *
 * @param {Object} invitation - Raw Prisma OwnerInvitation record
 * @param {Date} [now=new Date()] - Reference timestamp for expiration check
 * @returns {Object|null} Serialized, secret-free invitation object
 */
export function deriveInvitationLifecycle(invitation, now = new Date()) {
  if (!invitation) return null;

  const isExpired = new Date(invitation.expiresAt) <= now;

  let displayStatus;
  if (invitation.status === 'ACCEPTED') {
    displayStatus = 'ACCEPTED';
  } else if (invitation.status === 'SUPERSEDED') {
    displayStatus = 'SUPERSEDED';
  } else if (invitation.status === 'REVOKED') {
    displayStatus = 'REVOKED';
  } else if (invitation.status === 'EXPIRED' || (invitation.status === 'PENDING' && isExpired)) {
    displayStatus = 'EXPIRED';
  } else if (invitation.status === 'PENDING' && !isExpired) {
    displayStatus = 'INVITED_PENDING_ACCEPTANCE';
  } else {
    displayStatus = invitation.status;
  }

  return {
    id: invitation.id,
    nominatedPhone: invitation.invitedPhone,
    nominatedEmail: invitation.invitedEmail,
    rawStatus: invitation.status,
    status: displayStatus,
    isExpired,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt || null,
    revokedAt: invitation.revokedAt || null,
    createdAt: invitation.createdAt,
  };
}

/**
 * Creates a new Tenant, initializes OnboardingProgress, creates an OwnerInvitation,
 * and records an AuditLog entry in a single atomic transaction.
 *
 * Enforces:
 * - Slug uniqueness with clean HTTP 409 on collision.
 * - Multi-tenant ownership (same phone/email can be nominated across tenants).
 * - 256-bit CSPRNG bearer token with only SHA-256 hash stored at rest.
 * - Ephemeral activation URL with fragment (#token=) and WhatsApp Click-to-Chat URL.
 * - Zero token leakage in logs, audit records, or persisted tables.
 *
 * @param {Object} params
 * @param {string} params.legalName - Legal business/entity name
 * @param {string} [params.tradeName] - Optional trade/store display name
 * @param {string} params.slug - URL-safe unique slug
 * @param {string} params.ownerFullName - Full name of the nominated Store Owner
 * @param {string} params.ownerPhone - E.164 phone number of nominated Store Owner
 * @param {string} params.ownerEmail - Email address of nominated Store Owner
 * @param {string} params.actorUserId - ID of the acting Superadmin
 * @param {string} [params.ipAddress] - Request IP address
 * @param {string} [params.userAgent] - Request User-Agent header
 * @returns {Promise<Object>} Created tenant and ephemeral invitation metadata
 */
export async function createTenant({
  legalName,
  tradeName,
  slug,
  ownerFullName,
  ownerPhone,
  ownerEmail,
  actorUserId,
  ipAddress,
  userAgent,
}) {
  const normalizedSlug = slug.trim().toLowerCase();
  const trimmedLegalName = legalName.trim();
  const trimmedTradeName = tradeName && typeof tradeName === 'string' ? tradeName.trim() : null;
  const trimmedOwnerFullName = ownerFullName.trim();
  const normalizedPhone = ownerPhone.trim();
  const normalizedEmail = ownerEmail.trim().toLowerCase();

  // 1. Preflight uniqueness check for tenant slug
  const existingTenant = await prisma.tenant.findUnique({
    where: { slug: normalizedSlug },
  });

  if (existingTenant) {
    const err = new Error(`A store with slug "${normalizedSlug}" already exists.`);
    err.statusCode = 409;
    err.code = 'SLUG_ALREADY_EXISTS';
    throw err;
  }

  // 2. Generate 256-bit CSPRNG bearer invitation token (32 bytes Base64URL)
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);

  // 3. 12-hour expiration window (ADR-002)
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  let createdRecords;
  try {
    // 4. Atomic transaction creating Tenant, OnboardingProgress, OwnerInvitation, and AuditLog
    createdRecords = await prisma.$transaction(async (tx) => {
      // 4a. Create Tenant with INVITED status
      const tenant = await tx.tenant.create({
        data: {
          slug: normalizedSlug,
          legalName: trimmedLegalName,
          tradeName: trimmedTradeName,
          status: 'INVITED',
        },
      });

      // 4b. Initialize OnboardingProgress at Step 1
      const onboardingProgress = await tx.onboardingProgress.create({
        data: {
          tenantId: tenant.id,
          currentStep: 1,
          isCompleted: false,
          stepData: {},
        },
      });

      // 4c. Create OwnerInvitation with PENDING status and hashed token
      const ownerInvitation = await tx.ownerInvitation.create({
        data: {
          tenantId: tenant.id,
          invitedEmail: normalizedEmail,
          invitedPhone: normalizedPhone,
          tokenHash,
          status: 'PENDING',
          expiresAt,
          createdById: actorUserId || null,
        },
      });

      // 4d. Record AuditLog entry with strictly safe metadata (zero secrets/tokens)
      const auditLog = await tx.auditLog.create({
        data: {
          actorUserId: actorUserId || null,
          targetTenantId: tenant.id,
          eventType: 'TENANT_CREATED',
          action: 'CREATE_TENANT',
          resourceType: 'TENANT',
          resourceId: tenant.id,
          metadata: {
            slug: normalizedSlug,
            legalName: trimmedLegalName,
            tradeName: trimmedTradeName,
            nominatedPhone: normalizedPhone,
            nominatedEmail: normalizedEmail,
            ownerFullName: trimmedOwnerFullName,
            invitationId: ownerInvitation.id,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });

      return { tenant, onboardingProgress, ownerInvitation, auditLog };
    });
  } catch (err) {
    // Handle concurrent slug collision race caught by PostgreSQL unique constraint
    if (err.code === 'P2002' && err.meta?.target?.includes('slug')) {
      const collisionErr = new Error(`A store with slug "${normalizedSlug}" already exists.`);
      collisionErr.statusCode = 409;
      collisionErr.code = 'SLUG_ALREADY_EXISTS';
      throw collisionErr;
    }
    throw err;
  }

  // 5. Build ephemeral activation URL using fragment (#token=) to prevent HTTP/Referer leakage
  const appBaseUrl = env.APP_PUBLIC_URL || 'http://localhost:5173';
  const activationUrl = `${appBaseUrl}/owner/activate#token=${rawToken}`;

  // 6. Build official WhatsApp Click-to-Chat URL (wa.me)
  const storeDisplayName = trimmedTradeName || trimmedLegalName;
  const invitationMessage = generateInvitationMessage({
    ownerName: trimmedOwnerFullName,
    storeName: storeDisplayName,
    invitationLink: activationUrl,
    expiryHours: 12,
  });

  const whatsappUrl = generateWhatsAppLink({
    phone: normalizeWhatsAppPhone(normalizedPhone),
    message: invitationMessage,
  });

  // 7. Return safe response payload (rawToken returned once for ephemeral sharing; tokenHash never exposed)
  return {
    tenant: {
      id: createdRecords.tenant.id,
      slug: createdRecords.tenant.slug,
      legalName: createdRecords.tenant.legalName,
      tradeName: createdRecords.tenant.tradeName,
      status: createdRecords.tenant.status,
      createdAt: createdRecords.tenant.createdAt,
      updatedAt: createdRecords.tenant.updatedAt,
    },
    invitation: {
      id: createdRecords.ownerInvitation.id,
      status: 'INVITED_PENDING_ACCEPTANCE',
      nominatedPhone: createdRecords.ownerInvitation.invitedPhone,
      nominatedEmail: createdRecords.ownerInvitation.invitedEmail,
      activationUrl,
      whatsappUrl,
      rawToken,
      expiresAt: createdRecords.ownerInvitation.expiresAt,
      createdAt: createdRecords.ownerInvitation.createdAt,
    },
  };
}

/**
 * Retrieves a paginated list of Tenants with deterministic sorting and secret-free serializers.
 *
 * Enforces:
 * - Deterministic ordering: createdAt DESC, id DESC.
 * - Pagination bounds: limit between 1 and 50 (default 20), page >= 1.
 * - Search across legalName, tradeName, slug, and nominatedPhone with SQL wildcard escaping.
 * - TenantStatus filtering.
 * - Secret exclusion: zero token hashes, raw tokens, or credentials exposed.
 *
 * @param {Object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @param {string} [params.search]
 * @param {string} [params.status]
 * @returns {Promise<Object>} Paginated tenant list with metadata
 */
export async function listTenants({ page = 1, limit = 20, search, status } = {}) {
  const boundedPage = Math.max(1, parseInt(page, 10) || 1);
  const boundedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (boundedPage - 1) * boundedLimit;

  const where = {};

  if (status && ['INVITED', 'ACTIVE', 'SUSPENDED'].includes(status)) {
    where.status = status;
  }

  if (search && typeof search === 'string' && search.trim().length > 0) {
    const sanitizedSearch = search.trim().replace(/[%_]/g, '\\$&');
    where.OR = [
      { legalName: { contains: sanitizedSearch, mode: 'insensitive' } },
      { tradeName: { contains: sanitizedSearch, mode: 'insensitive' } },
      { slug: { contains: sanitizedSearch, mode: 'insensitive' } },
      {
        invitations: {
          some: {
            invitedPhone: { contains: sanitizedSearch, mode: 'insensitive' },
          },
        },
      },
    ];
  }

  const [total, tenants] = await Promise.all([
    prisma.tenant.count({ where }),
    prisma.tenant.findMany({
      where,
      skip,
      take: boundedLimit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        onboardingProgress: {
          select: {
            currentStep: true,
            isCompleted: true,
            completedAt: true,
          },
        },
        invitations: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            invitedPhone: true,
            invitedEmail: true,
            status: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const now = new Date();
  const serializedTenants = tenants.map((tenant) => {
    const latestInv =
      tenant.invitations && tenant.invitations.length > 0
        ? deriveInvitationLifecycle(tenant.invitations[0], now)
        : null;

    return {
      id: tenant.id,
      slug: tenant.slug,
      legalName: tenant.legalName,
      tradeName: tenant.tradeName,
      status: tenant.status,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      currentInvitation: latestInv,
      onboarding: tenant.onboardingProgress
        ? {
            currentStep: tenant.onboardingProgress.currentStep,
            isCompleted: tenant.onboardingProgress.isCompleted,
            completedAt: tenant.onboardingProgress.completedAt,
          }
        : null,
    };
  });

  const totalPages = Math.ceil(total / boundedLimit) || 1;

  return {
    tenants: serializedTenants,
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages,
      hasNextPage: boundedPage < totalPages,
      hasPrevPage: boundedPage > 1,
    },
  };
}

/**
 * Retrieves full tenant details, onboarding progress, and complete invitation history.
 *
 * Enforces:
 * - 404 response on unknown tenant ID.
 * - Secret exclusion: zero token hashes, raw tokens, or credentials exposed.
 * - Deterministic invitation lifecycle derivation.
 *
 * @param {string} tenantId - UUID of the tenant
 * @returns {Promise<Object>} Detailed tenant entity
 */
export async function getTenantById(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      onboardingProgress: {
        select: {
          currentStep: true,
          isCompleted: true,
          stepData: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      invitations: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          invitedPhone: true,
          invitedEmail: true,
          status: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }

  const now = new Date();
  const invitationHistory = tenant.invitations.map((inv) => deriveInvitationLifecycle(inv, now));

  const currentInvitation = invitationHistory.length > 0 ? invitationHistory[0] : null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    legalName: tenant.legalName,
    tradeName: tenant.tradeName,
    status: tenant.status,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
    currentInvitation,
    invitationHistory,
    onboarding: tenant.onboardingProgress
      ? {
          currentStep: tenant.onboardingProgress.currentStep,
          isCompleted: tenant.onboardingProgress.isCompleted,
          stepData: tenant.onboardingProgress.stepData,
          completedAt: tenant.onboardingProgress.completedAt,
          createdAt: tenant.onboardingProgress.createdAt,
          updatedAt: tenant.onboardingProgress.updatedAt,
        }
      : null,
  };
}
