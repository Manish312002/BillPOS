import { z } from 'zod';
import { SUBSCRIPTION_ERROR_CODES } from '../constants/errorCodes.js';

/**
 * Canonical Subscription Status Enum
 * Aligns with Prisma SubscriptionStatus enum
 */
export const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  GRACE_PERIOD: 'GRACE_PERIOD',
  READ_ONLY: 'READ_ONLY',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
  SUSPENDED: 'SUSPENDED',
});

/**
 * Statuses governed by the partial unique index:
 * idx_tenant_subscriptions_single_active
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.TRIAL,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.GRACE_PERIOD,
  SUBSCRIPTION_STATUS.READ_ONLY,
  SUBSCRIPTION_STATUS.SUSPENDED,
]);

/**
 * Statuses representing historical records
 */
export const HISTORICAL_SUBSCRIPTION_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.EXPIRED,
  SUBSCRIPTION_STATUS.CANCELED,
]);

/**
 * Canonical Billing Cycle Enum
 * Aligns with Prisma BillingCycle enum
 */
export const BILLING_CYCLE = Object.freeze({
  MONTHLY: 'MONTHLY',
  ANNUAL: 'ANNUAL',
});

/**
 * Canonical Subscription Invoice Status Enum
 * Aligns with Prisma SubscriptionInvoiceStatus enum
 */
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
});

/**
 * Canonical Subscription Payment Status Enum
 * Aligns with Prisma SubscriptionPaymentStatus enum
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED',
});

/**
 * Canonical Subscription Payment Method Enum
 * Aligns with Prisma SubscriptionPaymentMethod enum
 */
export const PAYMENT_METHOD = Object.freeze({
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CASH: 'CASH',
  GATEWAY_MOCK: 'GATEWAY_MOCK',
});

/**
 * Canonical Feature Value Type Enum
 * Aligns with Prisma FeatureValueType enum
 */
export const FEATURE_VALUE_TYPE = Object.freeze({
  NUMERIC: 'NUMERIC',
  BOOLEAN: 'BOOLEAN',
  STRING: 'STRING',
  JSON: 'JSON',
});

/**
 * Canonical Feature Keys
 */
export const FEATURE_KEYS = Object.freeze({
  MAX_OUTLETS: 'max_outlets',
  MAX_USERS: 'max_users',
  MAX_DEVICES: 'max_devices',
  MAX_PRODUCTS: 'max_products',
  OFFLINE_POS: 'offline_pos',
  ADVANCED_REPORTS: 'advanced_reports',
});

/**
 * Canonical Decimal Integer String Regex
 * Strictly matches canonical non-negative decimal integer strings:
 * - "0"
 * - Positive integers starting with 1-9 (e.g., "1", "14900")
 * Strictly rejects leading zeros ("00", "0014900"), signs ("+14900", "-14900"),
 * decimals ("149.00"), scientific notation ("1e4"), whitespace, and empty strings.
 */
export const CANONICAL_DECIMAL_INTEGER_REGEX = /^(?:0|[1-9]\d*)$/;

/**
 * Canonical Positive Integer String Regex
 * Strictly matches canonical positive decimal integer strings (> 0).
 */
export const CANONICAL_POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

// Backwards-compatible alias for existing imports
export const DECIMAL_INTEGER_REGEX = CANONICAL_DECIMAL_INTEGER_REGEX;

/**
 * Strict Zod schema for canonical decimal integer strings representing paise
 * Whitespace is strictly rejected (no automatic trimming).
 */
export const decimalIntegerPaiseSchema = z
  .string({ required_error: 'Amount in paise is required' })
  .regex(CANONICAL_DECIMAL_INTEGER_REGEX, {
    message: 'Must be a canonical decimal integer string representing paise without leading zeros, signs, whitespace, or decimals',
  });

/**
 * Strict Zod schema for canonical positive decimal integer strings representing paise (> 0)
 * Whitespace is strictly rejected (no automatic trimming).
 */
export const positiveDecimalIntegerPaiseSchema = z
  .string({ required_error: 'Positive amount in paise is required' })
  .regex(CANONICAL_POSITIVE_INTEGER_REGEX, {
    message: 'Must be a positive canonical decimal integer string representing paise (> 0) without leading zeros, signs, whitespace, or decimals',
  });

/**
 * Zod transformer from decimal integer string to native JavaScript BigInt
 */
export const decimalIntegerPaiseToBigIntSchema = decimalIntegerPaiseSchema.transform((val) =>
  BigInt(val)
);

/**
 * Zod schema for PlanPrice input
 */
export const planPriceInputSchema = z.object({
  billingCycle: z.enum([BILLING_CYCLE.MONTHLY, BILLING_CYCLE.ANNUAL], {
    errorMap: () => ({ message: 'Invalid billing cycle (must be MONTHLY or ANNUAL)' }),
  }),
  amountPaise: decimalIntegerPaiseSchema,
  currency: z.string().trim().length(3).default('INR'),
});

/**
 * Zod schema for Creating / Updating Subscription Plans
 */
export const createPlanSchema = z.object({
  code: z
    .string({ required_error: 'Plan code is required' })
    .trim()
    .min(3, 'Plan code must be at least 3 characters')
    .max(32, 'Plan code must not exceed 32 characters')
    .regex(/^[A-Z0-9_]+$/, 'Plan code must contain only uppercase alphanumeric characters and underscores'),
  name: z
    .string({ required_error: 'Plan name is required' })
    .trim()
    .min(3, 'Plan name must be at least 3 characters')
    .max(64, 'Plan name must not exceed 64 characters'),
  description: z.string().trim().max(256).optional().nullable(),
  trialDays: z.number().int().min(0, 'Trial days must be non-negative').default(0),
  isPublic: z.boolean().default(true),
  prices: z.array(planPriceInputSchema).min(1, 'At least one price configuration is required'),
  features: z.record(z.string(), z.union([z.boolean(), z.number().int(), z.string()])),
  reason: z
    .string({ required_error: 'Audit justification reason is required' })
    .trim()
    .min(10, 'Mandatory audit justification must be at least 10 characters'),
});

/**
 * Zod schema for Assigning a Plan to a Tenant (Superadmin mutation)
 */
export const assignPlanSchema = z.object({
  tenantId: z.string().uuid({ message: 'Invalid tenant UUID' }),
  planCode: z.string().trim().min(3).max(32),
  billingCycle: z.enum([BILLING_CYCLE.MONTHLY, BILLING_CYCLE.ANNUAL]),
  reason: z
    .string({ required_error: 'Audit justification reason is required' })
    .trim()
    .min(10, 'Mandatory audit justification must be at least 10 characters'),
});

/**
 * Zod schema for Manual Subscription Period Extension (Scenario 7)
 */
export const extendSubscriptionSchema = z.object({
  extensionDays: z
    .number({ required_error: 'Extension days required' })
    .int()
    .positive('Extension days must be positive')
    .max(365, 'Extension cannot exceed 365 days'),
  reason: z
    .string({ required_error: 'Audit justification reason is required' })
    .trim()
    .min(10, 'Mandatory audit justification must be at least 10 characters'),
});

/**
 * Zod schema for Granting an Entitlement Override (Scenario 9)
 */
export const grantOverrideSchema = z.object({
  featureKey: z.string().trim().min(1).max(64),
  overrideValue: z.union([z.boolean(), z.number().int(), z.string()]),
  expiresAt: z.string().datetime().optional().nullable(),
  reason: z
    .string({ required_error: 'Audit justification reason is required' })
    .trim()
    .min(10, 'Mandatory audit justification must be at least 10 characters'),
});

/**
 * Zod schema for Submitting a Payment UTR by Store Owner (D-09)
 */
export const submitUtrSchema = z.object({
  invoiceId: z.string().uuid({ message: 'Invalid invoice UUID' }),
  amountPaise: decimalIntegerPaiseSchema,
  referenceNumber: z
    .string({ required_error: 'Reference number is required' })
    .trim()
    .min(6, 'Reference number must be at least 6 characters')
    .max(32, 'Reference number must not exceed 32 characters')
    .transform((val) => val.trim().toUpperCase()),
  method: z
    .enum([PAYMENT_METHOD.UPI, PAYMENT_METHOD.BANK_TRANSFER])
    .default(PAYMENT_METHOD.UPI),
  proofDocumentUrl: z.string().trim().url({ message: 'Invalid proof document URL' }).optional().nullable(),
  notes: z.string().trim().max(256).optional().nullable(),
});

/**
 * Zod schema for Verifying a Payment by Superadmin (D-09)
 */
export const verifyPaymentSchema = z.object({
  receivedPaise: decimalIntegerPaiseSchema,
  bankTransactionDate: z.string().datetime({ message: 'Valid ISO datetime required for bank transaction date' }),
  reason: z
    .string({ required_error: 'Audit justification reason is required' })
    .trim()
    .min(10, 'Mandatory audit justification must be at least 10 characters'),
});

/**
 * Zod schema for Rejecting a Payment by Superadmin
 */
export const rejectPaymentSchema = z.object({
  reason: z
    .string({ required_error: 'Rejection reason is required' })
    .trim()
    .min(10, 'Mandatory rejection reason must be at least 10 characters'),
});

/**
 * Zod schema for Pairing a POS Device (Clarification A)
 */
export const pairPosDeviceSchema = z.object({
  outletId: z.string().uuid({ message: 'Invalid outlet UUID' }),
  deviceName: z
    .string({ required_error: 'Device name is required' })
    .trim()
    .min(2, 'Device name must be at least 2 characters')
    .max(64, 'Device name must not exceed 64 characters'),
  devicePublicKeyPem: z
    .string({ required_error: 'Device public key PEM is required' })
    .trim()
    .min(64, 'Valid PEM encoded public key from Android Keystore is required'),
  clientTelemetry: z
    .object({
      androidVersion: z.string().optional(),
      appVersion: z.string().optional(),
      deviceModel: z.string().optional(),
    })
    .optional(),
});

/**
 * Zod schema for Recovering from TAMPER_LOCKED State
 */
export const recoverTamperSchema = z.object({
  deviceId: z.string().uuid({ message: 'Invalid device UUID' }),
  localTamperTimestamp: z.string().datetime({ message: 'Valid ISO datetime required for local tamper timestamp' }),
  clientClock: z.string().datetime({ message: 'Valid ISO datetime required for client clock' }),
  offlineQueueCount: z.number().int().nonnegative('Offline queue count cannot be negative'),
});
