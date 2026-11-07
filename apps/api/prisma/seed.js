import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Normalizes phone number to E.164 format.
 * Strips whitespace, dashes, brackets, and ensures leading '+'.
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new Error('Phone number must be a non-empty string');
  }

  const cleaned = rawPhone.replace(/[\s\-()]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new Error(
      `Invalid E.164 phone format. Expected format like +918380989776, got: "${cleaned}"`
    );
  }
  return cleaned;
}

/**
 * Validates password strength policy:
 * - Minimum 10 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 * - At least 1 special symbol
 */
export function validatePasswordPolicy(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  if (password.length < 10) {
    throw new Error('Password must be at least 10 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    throw new Error('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new Error('Password must contain at least one digit');
  }
  if (!/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) {
    throw new Error('Password must contain at least one special symbol');
  }
  return true;
}

/**
 * Idempotent root Superadmin provisioning workflow.
 */
export async function seedRootSuperadmin({
  phone = process.env.ROOT_SUPERADMIN_PHONE || '+918380989776',
  email = process.env.ROOT_SUPERADMIN_EMAIL || 'superadmin@billingbuddy.com',
  fullName = 'Platform Root Superadmin',
  password = process.env.ROOT_SUPERADMIN_INITIAL_PASSWORD,
  client = prisma,
} = {}) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = email.trim().toLowerCase();

  // Check if a root superadmin already exists with this phone or email
  const existingUserByPhone = await client.user.findUnique({
    where: { phone: normalizedPhone },
    include: { platformAuthorization: true },
  });

  const existingUserByEmail = await client.user.findUnique({
    where: { email: normalizedEmail },
    include: { platformAuthorization: true },
  });

  if (
    existingUserByPhone &&
    existingUserByEmail &&
    existingUserByPhone.id !== existingUserByEmail.id
  ) {
    throw new Error(
      'Account conflict: Different accounts exist with the configured phone and email.'
    );
  }

  const existingUser = existingUserByPhone || existingUserByEmail;

  if (existingUser) {
    // Account already provisioned. Validate platform authorization.
    if (!existingUser.platformAuthorization) {
      // Reconcile missing platform authorization
      await client.platformAuthorization.create({
        data: {
          userId: existingUser.id,
          role: 'SUPERADMIN',
          status: 'ACTIVE',
        },
      });
      console.log(
        `[Seed] Reconciled platform authorization for existing root user (ID: ${existingUser.id}).`
      );
    } else {
      console.log(
        `[Seed] Root Superadmin already provisioned (ID: ${existingUser.id}). Password preserved; zero overwrite.`
      );
    }

    return {
      status: 'PRESERVED',
      userId: existingUser.id,
      phone: existingUser.phone,
      email: existingUser.email,
    };
  }

  // New provisioning: Password secret is mandatory
  if (!password) {
    throw new Error(
      'Cannot provision new root Superadmin: ROOT_SUPERADMIN_INITIAL_PASSWORD is not configured in environment.'
    );
  }

  validatePasswordPolicy(password);

  // Hash password using native bcrypt with cost factor 12
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // Create User and PlatformAuthorization atomically in a transaction
  const createdUser = await client.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        status: 'ACTIVE',
        phoneVerified: true,
        emailVerified: false,
        mustChangePassword: true, // Mandatory password change flag
      },
    });

    await tx.platformAuthorization.create({
      data: {
        userId: user.id,
        role: 'SUPERADMIN',
        status: 'ACTIVE',
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        eventType: 'PLATFORM.BOOTSTRAP',
        action: 'SUPERADMIN.PROVISIONED',
        resourceType: 'User',
        resourceId: user.id,
        metadata: {
          phone: normalizedPhone,
          email: normalizedEmail,
          role: 'SUPERADMIN',
          mustChangePassword: true,
        },
      },
    });

    return user;
  });

  console.log(
    `[Seed] Successfully provisioned root Superadmin (ID: ${createdUser.id}) with phone: ${normalizedPhone}`
  );

  return {
    status: 'CREATED',
    userId: createdUser.id,
    phone: createdUser.phone,
    email: createdUser.email,
  };
}

// Direct execution entrypoint
async function main() {
  try {
    await seedRootSuperadmin();
  } catch (error) {
    console.error('[Seed Error]', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  main();
}
