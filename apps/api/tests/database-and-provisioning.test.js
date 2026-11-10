import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { normalizePhone, validatePasswordPolicy, seedRootSuperadmin } from '../prisma/seed.js';

const prisma = new PrismaClient();

describe('Root Superadmin Provisioning & Phone / Password Utilities', () => {
  it('normalizes various phone number formats into E.164 standard', () => {
    expect(normalizePhone('+91 83809 89776')).toBe('+918380989776');
    expect(normalizePhone('+91-83809-89776')).toBe('+918380989776');
    expect(normalizePhone('+91 (83809) 89776')).toBe('+918380989776');
  });

  it('rejects invalid or malformed phone numbers', () => {
    expect(() => normalizePhone('8380989776')).toThrow(/Invalid E\.164/i);
    expect(() => normalizePhone('invalid')).toThrow(/Invalid E\.164/i);
    expect(() => normalizePhone(null)).toThrow(/non-empty string/i);
  });

  it('enforces password complexity policy', () => {
    // Too short (< 10)
    expect(() => validatePasswordPolicy('Short1!')).toThrow(/at least 10 characters/i);
    // Missing uppercase
    expect(() => validatePasswordPolicy('lowercase123!@#')).toThrow(/uppercase letter/i);
    // Missing lowercase
    expect(() => validatePasswordPolicy('UPPERCASE123!@#')).toThrow(/lowercase letter/i);
    // Missing digit
    expect(() => validatePasswordPolicy('NoDigitsHere!@#')).toThrow(/digit/i);
    // Missing symbol
    expect(() => validatePasswordPolicy('NoSymbols12345')).toThrow(/special symbol/i);
    // Valid password
    expect(validatePasswordPolicy('SuperAdmin@BillingBuddy2026!')).toBe(true);
  });

  it('fails safely when provisioning a new user without a password secret', async () => {
    const randomPhone = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;
    await expect(
      seedRootSuperadmin({
        phone: randomPhone,
        email: `unprovisioned_${Date.now()}@example.com`,
        password: null,
        client: prisma,
      })
    ).rejects.toThrow(/ROOT_SUPERADMIN_INITIAL_PASSWORD is not configured/i);
  });

  it('is strictly idempotent and preserves existing root superadmin password on re-seed', async () => {
    const originalUser = await prisma.user.findUnique({
      where: { phone: '+918380989776' },
    });
    const originalMustChange = originalUser?.mustChangePassword ?? false;

    try {
      await prisma.user.updateMany({
        where: { phone: '+918380989776' },
        data: { mustChangePassword: true },
      });

      const rootUser = await prisma.user.findUnique({
        where: { phone: '+918380989776' },
        include: { platformAuthorization: true },
      });

      expect(rootUser).toBeDefined();
      expect(rootUser.phone).toBe('+918380989776');
      expect(rootUser.platformAuthorization).toBeDefined();
      expect(rootUser.platformAuthorization.role).toBe('SUPERADMIN');
      expect(rootUser.mustChangePassword).toBe(true);

      const initialHash = rootUser.passwordHash;
      expect(initialHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt format with 12 rounds

      // Execute seed again with a different password
      const result = await seedRootSuperadmin({
        phone: '+918380989776',
        email: rootUser.email,
        password: 'DifferentPassword@2026!',
        client: prisma,
      });

      expect(result.status).toBe('PRESERVED');

      // Confirm database password hash was NOT overwritten
      const recheckedUser = await prisma.user.findUnique({
        where: { phone: '+918380989776' },
      });
      expect(recheckedUser.passwordHash).toBe(initialHash);
    } finally {
      // Restore original state so subsequent test suites or local dev do not see corrupted mustChangePassword
      await prisma.user.updateMany({
        where: { phone: '+918380989776' },
        data: { mustChangePassword: originalMustChange },
      });
    }
  });
});

describe('Prisma Multi-Tenant Data Model & Integrity Constraints', () => {
  const testRunId = Date.now();
  let createdTenantId;
  let testUserId;

  beforeAll(async () => {
    // Setup test tenant
    const tenant = await prisma.tenant.create({
      data: {
        slug: `test-store-${testRunId}`,
        legalName: 'Test Retail Private Limited',
        tradeName: 'Test Mart',
        status: 'ACTIVE',
      },
    });
    createdTenantId = tenant.id;

    // Setup test user
    const user = await prisma.user.create({
      data: {
        fullName: 'Store Manager',
        email: `manager_${testRunId}@testmart.com`,
        phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Clean up created test entities
    if (createdTenantId) {
      await prisma.tenant.delete({ where: { id: createdTenantId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('enforces uniqueness on User phone number', async () => {
    const existing = await prisma.user.findUnique({ where: { id: testUserId } });
    await expect(
      prisma.user.create({
        data: {
          fullName: 'Duplicate Phone User',
          phone: existing.phone,
          status: 'ACTIVE',
        },
      })
    ).rejects.toThrow();
  });

  it('enforces uniqueness on PlatformAuthorization (one per user)', async () => {
    // Give user platform auth
    await prisma.platformAuthorization.create({
      data: {
        userId: testUserId,
        role: 'SUPERADMIN',
        status: 'ACTIVE',
      },
    });

    // Attempt second platform auth on same user
    await expect(
      prisma.platformAuthorization.create({
        data: {
          userId: testUserId,
          role: 'SUPERADMIN',
          status: 'ACTIVE',
        },
      })
    ).rejects.toThrow();
  });

  it('enforces composite uniqueness on TenantMembership (tenantId, userId)', async () => {
    // Create first membership
    await prisma.tenantMembership.create({
      data: {
        tenantId: createdTenantId,
        userId: testUserId,
        role: 'STORE_OWNER',
        status: 'ACTIVE',
      },
    });

    // Attempt duplicate membership for same user in same tenant
    await expect(
      prisma.tenantMembership.create({
        data: {
          tenantId: createdTenantId,
          userId: testUserId,
          role: 'STORE_CASHIER',
          status: 'ACTIVE',
        },
      })
    ).rejects.toThrow();
  });

  it('enforces uniqueness on Session sessionTokenHash', async () => {
    const tokenHash = `hash_${testRunId}_session_token_12345`;
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        sessionTokenHash: tokenHash,
        userId: testUserId,
        sessionType: 'TENANT',
        activeTenantId: createdTenantId,
        idleExpiresAt,
        absoluteExpiresAt,
      },
    });

    // Duplicate token hash must fail
    await expect(
      prisma.session.create({
        data: {
          sessionTokenHash: tokenHash,
          userId: testUserId,
          sessionType: 'TENANT',
          activeTenantId: createdTenantId,
          idleExpiresAt,
          absoluteExpiresAt,
        },
      })
    ).rejects.toThrow();
  });

  it('supports OTPChallenge creation with purpose, digest, and attempt bounds', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const resendAvailableAt = new Date(Date.now() + 60 * 1000);

    const otpChallenge = await prisma.oTPChallenge.create({
      data: {
        purpose: 'SUPERADMIN_LOGIN',
        userId: testUserId,
        destination: '+918380989776',
        otpDigest: 'sha256_mock_digest_for_testing_only',
        deliveryChannel: 'WHATSAPP',
        maxAttempts: 3,
        attemptsCount: 0,
        expiresAt,
        resendAvailableAt,
      },
    });

    expect(otpChallenge.id).toBeDefined();
    expect(otpChallenge.purpose).toBe('SUPERADMIN_LOGIN');
    expect(otpChallenge.maxAttempts).toBe(3);
    expect(otpChallenge.attemptsCount).toBe(0);
  });

  it('enforces uniqueness on OwnerInvitation tokenHash', async () => {
    const invitationTokenHash = `inv_token_${testRunId}_unique`;
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    await prisma.ownerInvitation.create({
      data: {
        tenantId: createdTenantId,
        invitedEmail: 'owner@teststore.com',
        invitedPhone: '+919876543210',
        tokenHash: invitationTokenHash,
        status: 'PENDING',
        expiresAt,
      },
    });

    // Duplicate tokenHash must fail
    await expect(
      prisma.ownerInvitation.create({
        data: {
          tenantId: createdTenantId,
          invitedEmail: 'other@teststore.com',
          invitedPhone: '+919876543211',
          tokenHash: invitationTokenHash,
          status: 'PENDING',
          expiresAt,
        },
      })
    ).rejects.toThrow();
  });

  it('persists and retrieves OnboardingProgress with structured JSON step data', async () => {
    const onboarding = await prisma.onboardingProgress.create({
      data: {
        tenantId: createdTenantId,
        currentStep: 3,
        isCompleted: false,
        stepData: {
          step1: { tradeName: 'Test Mart', category: 'Grocery' },
          step2: { city: 'Pune', state: 'Maharashtra', pinCode: '411001' },
          step3: { gstRegistered: false },
        },
      },
    });

    expect(onboarding.tenantId).toBe(createdTenantId);
    expect(onboarding.currentStep).toBe(3);
    expect(onboarding.isCompleted).toBe(false);
    expect(onboarding.stepData.step1.tradeName).toBe('Test Mart');
  });

  it('records AuditLog entries without exposing sensitive secrets in metadata', async () => {
    const audit = await prisma.auditLog.create({
      data: {
        actorUserId: testUserId,
        targetTenantId: createdTenantId,
        eventType: 'TENANT.STORE_UPDATED',
        action: 'UPDATE_SETTINGS',
        resourceType: 'Tenant',
        resourceId: createdTenantId,
        metadata: {
          fieldChanged: 'tradeName',
          previousValue: 'Test Mart',
          newValue: 'Super Test Mart',
        },
      },
    });

    expect(audit.id).toBeDefined();
    expect(audit.metadata).toBeDefined();
    // Verify no password, token, or secret strings are present
    const metaString = JSON.stringify(audit.metadata);
    expect(metaString).not.toMatch(/password/i);
    expect(metaString).not.toMatch(/otp/i);
    expect(metaString).not.toMatch(/sessionToken/i);
  });
});
