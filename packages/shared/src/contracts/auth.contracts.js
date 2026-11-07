import { z } from 'zod';

/**
 * Standard E.164 phone number schema (+918380989776)
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone number must be a valid E.164 international format (e.g., +918380989776)',
  });

/**
 * Standard password complexity policy schema:
 * - Minimum 10 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 * - At least 1 special symbol
 */
export const passwordPolicySchema = z
  .string()
  .min(10, { message: 'Password must be at least 10 characters long' })
  .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  .regex(/[0-9]/, { message: 'Password must contain at least one digit' })
  .regex(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/, {
    message: 'Password must contain at least one special symbol',
  });

/**
 * Superadmin credential login request schema
 */
export const superadminLoginSchema = z.object({
  identifier: z.string().trim().min(3, { message: 'Identifier (phone or email) is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

/**
 * OTP verification request schema
 */
export const otpVerificationSchema = z.object({
  challengeId: z.string().uuid({ message: 'Valid challenge UUID is required' }),
  otp: z
    .string()
    .trim()
    .length(6, { message: 'OTP must be exactly 6 digits' })
    .regex(/^\d{6}$/, { message: 'OTP must contain only numerical digits' }),
});

/**
 * Superadmin Tenant creation & Owner invitation schema
 */
export const createTenantSchema = z.object({
  legalName: z.string().trim().min(2, { message: 'Legal business name is required' }),
  tradeName: z.string().trim().optional(),
  slug: z
    .string()
    .trim()
    .min(2, { message: 'Slug must be at least 2 characters' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Slug must be lowercase alphanumeric with optional single hyphens',
    }),
  ownerPhone: phoneSchema,
  ownerEmail: z.string().trim().toLowerCase().email({ message: 'Valid owner email is required' }),
  ownerFullName: z.string().trim().min(2, { message: 'Owner full name is required' }),
});

/**
 * Resend Owner invitation schema
 */
export const resendInvitationSchema = z.object({
  invitationId: z.string().uuid({ message: 'Valid invitation UUID is required' }),
});

/**
 * Store Owner activation request schema
 */
export const ownerActivationSchema = z.object({
  token: z.string().trim().min(16, { message: 'Valid invitation token is required' }),
  otp: z
    .string()
    .trim()
    .length(6, { message: 'OTP must be exactly 6 digits' })
    .regex(/^\d{6}$/, { message: 'OTP must contain only numerical digits' }),
  password: passwordPolicySchema,
});

/**
 * Store Owner credential login request schema
 */
export const ownerLoginSchema = z.object({
  identifier: z.string().trim().min(3, { message: 'Identifier (phone or email) is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
  tenantSlug: z.string().trim().optional(),
});
