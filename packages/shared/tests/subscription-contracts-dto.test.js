import { describe, it, expect, vi } from 'vitest';
import * as currencyModule from '../src/utils/currency.js';
import {
  // Enums & constants
  SUBSCRIPTION_STATUS,
  ACTIVE_SUBSCRIPTION_STATUSES,
  HISTORICAL_SUBSCRIPTION_STATUSES,
  BILLING_CYCLE,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  FEATURE_VALUE_TYPE,
  FEATURE_KEYS,
  CANONICAL_DECIMAL_INTEGER_REGEX,
  CANONICAL_POSITIVE_INTEGER_REGEX,
  // Zod Schemas
  decimalIntegerPaiseSchema,
  positiveDecimalIntegerPaiseSchema,
  decimalIntegerPaiseToBigIntSchema,
  planPriceInputSchema,
  createPlanSchema,
  assignPlanSchema,
  extendSubscriptionSchema,
  grantOverrideSchema,
  submitUtrSchema,
  verifyPaymentSchema,
  rejectPaymentSchema,
  pairPosDeviceSchema,
  recoverTamperSchema,
  // Currency math
  toBigIntPaise,
  addPaise,
  subtractPaise,
  multiplyPaise,
  calculateTaxPaise,
  calculateInvoiceBreakdown,
  formatINR,
  rupeesToPaise,
  paiseToRupees,
  // DTOs
  formatPaiseDto,
  resolvePlanFeatureValue,
  toPlanPriceDto,
  toPlanFeatureDto,
  toPlanDto,
  toSubscriptionPaymentDto,
  toSubscriptionInvoiceDto,
  toTenantSubscriptionDto,
  toTenantEntitlementOverrideDto,
} from '../src/index.js';

describe('WP-SUB-02 Slice 2: Subscription Contracts, DTOs & Currency Math', () => {
  describe('Global Prototype Guarantee', () => {
    it('strictly guarantees BigInt.prototype.toJSON is NOT modified or monkey-patched', () => {
      expect(BigInt.prototype.toJSON).toBeUndefined();
    });

    it('verifies native JSON.stringify throws TypeError on raw BigInt', () => {
      expect(() => JSON.stringify({ amount: 99900n })).toThrow(TypeError);
    });
  });

  describe('Canonical Enums & Statuses', () => {
    it('defines canonical subscription lifecycle statuses', () => {
      expect(SUBSCRIPTION_STATUS.TRIAL).toBe('TRIAL');
      expect(SUBSCRIPTION_STATUS.ACTIVE).toBe('ACTIVE');
      expect(SUBSCRIPTION_STATUS.GRACE_PERIOD).toBe('GRACE_PERIOD');
      expect(SUBSCRIPTION_STATUS.READ_ONLY).toBe('READ_ONLY');
      expect(SUBSCRIPTION_STATUS.EXPIRED).toBe('EXPIRED');
      expect(SUBSCRIPTION_STATUS.CANCELED).toBe('CANCELED');
      expect(SUBSCRIPTION_STATUS.SUSPENDED).toBe('SUSPENDED');
      expect(Object.isFrozen(SUBSCRIPTION_STATUS)).toBe(true);
    });

    it('defines active vs historical statuses for partial unique index alignment', () => {
      expect(ACTIVE_SUBSCRIPTION_STATUSES).toEqual([
        'TRIAL',
        'ACTIVE',
        'GRACE_PERIOD',
        'READ_ONLY',
        'SUSPENDED',
      ]);
      expect(HISTORICAL_SUBSCRIPTION_STATUSES).toEqual(['EXPIRED', 'CANCELED']);
    });

    it('defines billing cycles, invoice statuses, and payment methods', () => {
      expect(BILLING_CYCLE.MONTHLY).toBe('MONTHLY');
      expect(BILLING_CYCLE.ANNUAL).toBe('ANNUAL');
      expect(INVOICE_STATUS.ISSUED).toBe('ISSUED');
      expect(PAYMENT_STATUS.VERIFIED).toBe('VERIFIED');
      expect(PAYMENT_METHOD.UPI).toBe('UPI');
      expect(FEATURE_KEYS.MAX_OUTLETS).toBe('max_outlets');
    });
  });

  describe('Decimal Integer String Validation (Clarification B & Finding 2)', () => {
    it('accepts valid canonical decimal integer strings', () => {
      expect(decimalIntegerPaiseSchema.parse('0')).toBe('0');
      expect(decimalIntegerPaiseSchema.parse('1')).toBe('1');
      expect(decimalIntegerPaiseSchema.parse('14900')).toBe('14900');
      expect(decimalIntegerPaiseSchema.parse('99900')).toBe('99900');
      expect(decimalIntegerPaiseSchema.parse('1000000000000000000')).toBe('1000000000000000000');
    });

    it('rejects leading zeros ("00", "0014900")', () => {
      expect(() => decimalIntegerPaiseSchema.parse('00')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('0014900')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('01')).toThrow();
    });

    it('rejects signs ("+14900", "-14900")', () => {
      expect(() => decimalIntegerPaiseSchema.parse('+14900')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('-14900')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('+0')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('-0')).toThrow();
    });

    it('rejects floating-point string representations ("149.00")', () => {
      expect(() => decimalIntegerPaiseSchema.parse('149.00')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('999.00')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('149.5')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('0.00')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('.50')).toThrow();
    });

    it('rejects scientific notation ("1e4")', () => {
      expect(() => decimalIntegerPaiseSchema.parse('1e4')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('1e5')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('9.99e4')).toThrow();
    });

    it('rejects whitespace and empty strings', () => {
      expect(() => decimalIntegerPaiseSchema.parse('')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(' ')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('   ')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(' 14900 ')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('14900 ')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(' 14900')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('\t14900\n')).toThrow();
    });

    it('rejects non-digit strings and non-string inputs', () => {
      expect(() => decimalIntegerPaiseSchema.parse('abc')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse('99900a')).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(99900)).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(null)).toThrow();
      expect(() => decimalIntegerPaiseSchema.parse(undefined)).toThrow();
    });

    it('validates strictly positive canonical decimal integer strings', () => {
      expect(positiveDecimalIntegerPaiseSchema.parse('1')).toBe('1');
      expect(positiveDecimalIntegerPaiseSchema.parse('14900')).toBe('14900');
      expect(positiveDecimalIntegerPaiseSchema.parse('99900')).toBe('99900');
      // Rejects "0"
      expect(() => positiveDecimalIntegerPaiseSchema.parse('0')).toThrow();
      // Rejects leading zeros, signs, whitespace, decimals
      expect(() => positiveDecimalIntegerPaiseSchema.parse('00')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('0014900')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('+14900')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('-14900')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('149.00')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('1e4')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse(' 14900 ')).toThrow();
      expect(() => positiveDecimalIntegerPaiseSchema.parse('')).toThrow();
    });

    it('transforms canonical decimal integer string to native BigInt', () => {
      const parsedBigInt = decimalIntegerPaiseToBigIntSchema.parse('99900');
      expect(parsedBigInt).toBe(99900n);
      expect(typeof parsedBigInt).toBe('bigint');

      const largeValue = '12345678901234567890';
      const parsedLarge = decimalIntegerPaiseToBigIntSchema.parse(largeValue);
      expect(parsedLarge).toBe(12345678901234567890n);
      expect(parsedLarge.toString()).toBe(largeValue);
    });
  });

  describe('Currency Math & Zero-Float Arithmetic (currency.js - Finding 1)', () => {
    describe('toBigIntPaise (Safe Number & Canonical String Conversion)', () => {
      it('accepts BigInt directly', () => {
        expect(toBigIntPaise(0n)).toBe(0n);
        expect(toBigIntPaise(100n)).toBe(100n);
        expect(toBigIntPaise(99900n)).toBe(99900n);
      });

      it('accepts canonical decimal integer strings', () => {
        expect(toBigIntPaise('0')).toBe(0n);
        expect(toBigIntPaise('1')).toBe(1n);
        expect(toBigIntPaise('14900')).toBe(14900n);
        expect(toBigIntPaise('99900')).toBe(99900n);
      });

      it('accepts JavaScript Number only when Number.isSafeInteger is true', () => {
        expect(toBigIntPaise(0)).toBe(0n);
        expect(toBigIntPaise(1)).toBe(1n);
        expect(toBigIntPaise(14900)).toBe(14900n);
        expect(toBigIntPaise(99900)).toBe(99900n);
      });

      it('accepts Number.MAX_SAFE_INTEGER correctly without precision loss', () => {
        expect(Number.isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
        const result = toBigIntPaise(Number.MAX_SAFE_INTEGER);
        expect(result).toBe(9007199254740991n);
        expect(result.toString()).toBe('9007199254740991');
      });

      it('strictly rejects values beyond safe integer boundary (Number.MAX_SAFE_INTEGER + 1)', () => {
        expect(Number.isSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
        expect(() => toBigIntPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
        expect(() => toBigIntPaise(9007199254740992)).toThrow(TypeError);
        expect(() => toBigIntPaise(1e25)).toThrow(TypeError);
      });

      it('strictly rejects floating-point inputs', () => {
        expect(() => toBigIntPaise(149.5)).toThrow(TypeError);
        expect(() => toBigIntPaise(0.01)).toThrow(TypeError);
        expect(() => toBigIntPaise(149.0000000001)).toThrow(TypeError);
      });

      it('strictly rejects NaN, Infinity, and -Infinity', () => {
        expect(() => toBigIntPaise(NaN)).toThrow(TypeError);
        expect(() => toBigIntPaise(Infinity)).toThrow(TypeError);
        expect(() => toBigIntPaise(-Infinity)).toThrow(TypeError);
      });

      it('strictly rejects non-canonical strings ("00", "0014900", "+14900", "-14900", "149.00", "1e4", whitespace)', () => {
        expect(() => toBigIntPaise('00')).toThrow(TypeError);
        expect(() => toBigIntPaise('0014900')).toThrow(TypeError);
        expect(() => toBigIntPaise('+14900')).toThrow(TypeError);
        expect(() => toBigIntPaise('-14900')).toThrow(TypeError);
        expect(() => toBigIntPaise('149.00')).toThrow(TypeError);
        expect(() => toBigIntPaise('1e4')).toThrow(TypeError);
        expect(() => toBigIntPaise(' 14900 ')).toThrow(TypeError);
        expect(() => toBigIntPaise('')).toThrow(TypeError);
        expect(() => toBigIntPaise('abc')).toThrow(TypeError);
      });

      it('strictly rejects invalid input types (null, undefined, boolean, object)', () => {
        expect(() => toBigIntPaise(null)).toThrow(TypeError);
        expect(() => toBigIntPaise(undefined)).toThrow(TypeError);
        expect(() => toBigIntPaise(true)).toThrow(TypeError);
        expect(() => toBigIntPaise({})).toThrow(TypeError);
        expect(() => toBigIntPaise([])).toThrow(TypeError);
      });
    });

    describe('addPaise & subtractPaise', () => {
      it('adds paise without precision loss', () => {
        const sum = addPaise('99900', 100n);
        expect(sum).toBe(100000n);
      });

      it('subtracts paise safely', () => {
        const result = subtractPaise('100000', '100');
        expect(result).toBe(99900n);
      });

      it('throws on negative subtraction result unless allowed', () => {
        expect(() => subtractPaise('500', '1000')).toThrow(RangeError);
        expect(subtractPaise('500', '1000', { allowNegative: true })).toBe(-500n);
      });
    });

    describe('multiplyPaise', () => {
      it('multiplies paise by integer multiplier', () => {
        const total = multiplyPaise('99900', 3);
        expect(total).toBe(299700n);
      });

      it('rejects floating-point multipliers', () => {
        expect(() => multiplyPaise('99900', 2.5)).toThrow(TypeError);
      });
    });

    describe('calculateTaxPaise (Round-Half-Up Division Formula)', () => {
      it('calculates 18% GST on ₹999.00 (99,900 paise) correctly', () => {
        // 99900 * 18 = 1,798,200. (1,798,200 + 50) / 100 = 17982 paise (₹179.82)
        const tax = calculateTaxPaise('99900', 18);
        expect(tax).toBe(17982n);
      });

      it('rounds half up at exact 0.50 remainder', () => {
        // subtotal 50 paise, rate 1% -> (50 * 1 + 50) / 100 = 100 / 100 = 1
        expect(calculateTaxPaise(50n, 1)).toBe(1n);
        // subtotal 49 paise, rate 1% -> (49 * 1 + 50) / 100 = 99 / 100 = 0
        expect(calculateTaxPaise(49n, 1)).toBe(0n);
      });

      it('calculates invoice breakdown', () => {
        const breakdown = calculateInvoiceBreakdown('99900', 18);
        expect(breakdown.subtotalPaise).toBe(99900n);
        expect(breakdown.taxPaise).toBe(17982n);
        expect(breakdown.totalPaise).toBe(117882n);
        expect(breakdown.taxRatePercent).toBe(18n);
      });
    });

    describe('formatINR (Indian Rupee Localized Formatting)', () => {
      it('formats zero correctly', () => {
        expect(formatINR(0n)).toBe('₹0.00');
        expect(formatINR('0')).toBe('₹0.00');
      });

      it('formats standard amounts with ₹ symbol', () => {
        expect(formatINR('99900')).toBe('₹999.00');
        expect(formatINR(14900n)).toBe('₹149.00');
      });

      it('formats with Indian numbering system (Lakhs and Crores)', () => {
        // 1 Lakh = ₹1,00,000.00 (10,000,000 paise)
        expect(formatINR(10000000n)).toBe('₹1,00,000.00');
        // 1 Crore = ₹1,00,00,000.00 (1,000,000,000 paise)
        expect(formatINR(1000000000n)).toBe('₹1,00,00,000.00');
        // ₹12,34,567.89 = 123456789 paise
        expect(formatINR(123456789n)).toBe('₹12,34,567.89');
      });

      it('respects options', () => {
        expect(formatINR('99900', { currencySymbol: false })).toBe('999.00');
        expect(formatINR(-99900n, { allowNegative: true })).toBe('-₹999.00');
      });
    });
  });

  describe('Explicit DTO Transformers (Clarification B & Clean Wire Serialization)', () => {
    describe('formatPaiseDto', () => {
      it('formats paise to canonical DTO pair', () => {
        const dto = formatPaiseDto(99900n);
        expect(dto).toEqual({
          amountPaise: '99900',
          amountFormatted: '₹999.00',
        });
        expect(typeof dto.amountPaise).toBe('string');
      });

      it('handles null/undefined safely', () => {
        expect(formatPaiseDto(null)).toEqual({
          amountPaise: '0',
          amountFormatted: '₹0.00',
        });
        expect(formatPaiseDto(null, { allowNull: true })).toBeNull();
      });
    });

    describe('toPlanPriceDto', () => {
      it('transforms Prisma PlanPrice containing BigInt to JSON-serializable DTO', () => {
        const prismaPrice = {
          id: 'price-uuid-1',
          planId: 'plan-uuid-1',
          billingCycle: 'MONTHLY',
          currency: 'INR',
          amountPaise: 14900n, // Prisma BigInt
          isActive: true,
          createdAt: new Date('2026-11-10T12:00:00Z'),
          updatedAt: new Date('2026-11-10T12:00:00Z'),
        };

        const dto = toPlanPriceDto(prismaPrice);
        expect(dto.amountPaise).toBe('14900');
        expect(dto.amountFormatted).toBe('₹149.00');
        expect(typeof dto.amountPaise).toBe('string');
        expect(dto.isActive).toBe(true);
        expect(dto.createdAt).toBe('2026-11-10T12:00:00.000Z');

        // Verify JSON.stringify succeeds cleanly with NO TypeError
        const serialized = JSON.stringify(dto);
        expect(serialized).toContain('"amountPaise":"14900"');
        expect(serialized).toContain('"amountFormatted":"₹149.00"');
      });
    });

    describe('toPlanDto', () => {
      it('transforms complete plan with nested prices and features into clean DTO', () => {
        const prismaPlan = {
          id: 'plan-starter-uuid',
          code: 'STARTER',
          name: 'Starter Tier',
          description: 'Single outlet retail',
          trialDays: 14,
          isActive: true,
          isPublic: true,
          version: 1,
          prices: [
            {
              id: 'p1',
              planId: 'plan-starter-uuid',
              billingCycle: 'MONTHLY',
              currency: 'INR',
              amountPaise: 14900n,
              isActive: true,
              createdAt: new Date('2026-11-10T00:00:00Z'),
              updatedAt: new Date('2026-11-10T00:00:00Z'),
            },
            {
              id: 'p2',
              planId: 'plan-starter-uuid',
              billingCycle: 'ANNUAL',
              currency: 'INR',
              amountPaise: 149000n,
              isActive: true,
              createdAt: new Date('2026-11-10T00:00:00Z'),
              updatedAt: new Date('2026-11-10T00:00:00Z'),
            },
          ],
          features: [
            {
              id: 'f1',
              planId: 'plan-starter-uuid',
              featureKey: 'max_outlets',
              valueType: 'NUMERIC',
              valueNumeric: 1,
              valueBoolean: null,
              valueString: null,
              valueJson: null,
            },
            {
              id: 'f2',
              planId: 'plan-starter-uuid',
              featureKey: 'offline_pos',
              valueType: 'BOOLEAN',
              valueNumeric: null,
              valueBoolean: true,
              valueString: null,
              valueJson: null,
            },
          ],
          createdAt: new Date('2026-11-10T00:00:00Z'),
          updatedAt: new Date('2026-11-10T00:00:00Z'),
        };

        const dto = toPlanDto(prismaPlan);
        expect(dto.code).toBe('STARTER');
        expect(dto.prices).toHaveLength(2);
        expect(dto.prices[0].amountPaise).toBe('14900');
        expect(dto.prices[1].amountPaise).toBe('149000');
        expect(dto.features).toEqual({
          max_outlets: 1,
          offline_pos: true,
        });

        // Verify JSON stringification
        const json = JSON.stringify(dto);
        expect(json).toBeDefined();
        const roundTrip = JSON.parse(json);
        expect(roundTrip.features.max_outlets).toBe(1);
        expect(roundTrip.prices[0].amountPaise).toBe('14900');
      });
    });

    describe('toSubscriptionInvoiceDto & toSubscriptionPaymentDto', () => {
      it('transforms invoices with subtotal, tax, and total BigInts to decimal integer strings', () => {
        const prismaInvoice = {
          id: 'inv-uuid-1',
          tenantId: 'tenant-uuid-1',
          subscriptionId: 'sub-uuid-1',
          invoiceNumber: 'INV-202611-0001',
          billingCycle: 'MONTHLY',
          subtotalPaise: 99900n,
          taxRate: 18,
          taxPaise: 17982n,
          totalPaise: 117882n,
          currency: 'INR',
          status: 'PAID',
          dueDate: new Date('2026-11-15T00:00:00Z'),
          paidAt: new Date('2026-11-10T15:00:00Z'),
          payments: [
            {
              id: 'pay-uuid-1',
              invoiceId: 'inv-uuid-1',
              amountPaise: 117882n,
              referenceNumber: 'SBI123456789012',
              method: 'UPI',
              status: 'VERIFIED',
              rejectionReason: null,
              verifiedAt: new Date('2026-11-10T15:00:00Z'),
              bankTransactionDate: new Date('2026-11-10T14:30:00Z'),
              proofDocumentUrl: null,
              notes: 'Verified via SBI statement',
              createdAt: new Date('2026-11-10T14:35:00Z'),
              updatedAt: new Date('2026-11-10T15:00:00Z'),
            },
          ],
          createdAt: new Date('2026-11-10T14:00:00Z'),
          updatedAt: new Date('2026-11-10T15:00:00Z'),
        };

        const dto = toSubscriptionInvoiceDto(prismaInvoice);
        expect(dto.subtotalPaise).toBe('99900');
        expect(dto.subtotalFormatted).toBe('₹999.00');
        expect(dto.taxPaise).toBe('17982');
        expect(dto.taxFormatted).toBe('₹179.82');
        expect(dto.totalPaise).toBe('117882');
        expect(dto.totalFormatted).toBe('₹1,178.82');
        expect(dto.payments).toHaveLength(1);
        expect(dto.payments[0].amountPaise).toBe('117882');
        expect(dto.payments[0].referenceNumber).toBe('SBI123456789012');

        // Test JSON.stringify
        expect(() => JSON.stringify(dto)).not.toThrow();
      });
    });

    describe('toTenantSubscriptionDto', () => {
      it('transforms tenant subscription with relations', () => {
        const prismaSub = {
          id: 'sub-uuid-1',
          tenantId: 'tenant-uuid-1',
          planId: 'plan-starter-uuid',
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date('2026-11-10T00:00:00Z'),
          currentPeriodEnd: new Date('2026-12-10T00:00:00Z'),
          trialStartedAt: null,
          trialEndsAt: null,
          gracePeriodEndsAt: null,
          readOnlyStartsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          version: 2,
          plan: {
            id: 'plan-starter-uuid',
            code: 'STARTER',
            name: 'Starter Tier',
            prices: [],
            features: [],
          },
          invoices: [],
          overrides: [],
          createdAt: new Date('2026-11-10T00:00:00Z'),
          updatedAt: new Date('2026-11-10T00:00:00Z'),
        };

        const dto = toTenantSubscriptionDto(prismaSub);
        expect(dto.status).toBe('ACTIVE');
        expect(dto.currentPeriodEnd).toBe('2026-12-10T00:00:00.000Z');
        expect(dto.plan.code).toBe('STARTER');
        expect(() => JSON.stringify(dto)).not.toThrow();
      });
    });
  });

  describe('Zod Request / Mutation Validation Schemas', () => {
    describe('createPlanSchema', () => {
      it('validates a correct plan creation payload', () => {
        const payload = {
          code: 'PRO_TIER',
          name: 'Professional Tier',
          description: 'Multi-outlet retail',
          trialDays: 14,
          isPublic: true,
          prices: [
            {
              billingCycle: 'MONTHLY',
              amountPaise: '24900',
              currency: 'INR',
            },
          ],
          features: {
            max_outlets: 5,
            max_users: 10,
            offline_pos: true,
          },
          reason: 'Initial creation of Professional Tier for expanding stores',
        };

        const parsed = createPlanSchema.parse(payload);
        expect(parsed.code).toBe('PRO_TIER');
        expect(parsed.prices[0].amountPaise).toBe('24900');
      });

      it('rejects short reason (< 10 chars)', () => {
        const payload = {
          code: 'PRO_TIER',
          name: 'Professional Tier',
          prices: [{ billingCycle: 'MONTHLY', amountPaise: '24900' }],
          features: {},
          reason: 'Too short',
        };
        expect(() => createPlanSchema.parse(payload)).toThrow();
      });
    });

    describe('submitUtrSchema', () => {
      it('validates UTR submission and converts referenceNumber to uppercase', () => {
        const payload = {
          invoiceId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
          amountPaise: '99900',
          referenceNumber: 'sbi987654321012',
          method: 'UPI',
          notes: 'Paid via GPay to SBI QR',
        };

        const parsed = submitUtrSchema.parse(payload);
        expect(parsed.referenceNumber).toBe('SBI987654321012');
        expect(parsed.amountPaise).toBe('99900');
        expect(parsed.method).toBe('UPI');
      });

      it('rejects float amount in UTR submission', () => {
        const payload = {
          invoiceId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
          amountPaise: '999.00',
          referenceNumber: 'SBI987654321012',
        };
        expect(() => submitUtrSchema.parse(payload)).toThrow();
      });
    });

    describe('verifyPaymentSchema', () => {
      it('validates superadmin payment verification', () => {
        const payload = {
          receivedPaise: '99900',
          bankTransactionDate: '2026-11-10T14:30:00.000Z',
          reason: 'Bank statement verified against SBI corporate account',
        };
        const parsed = verifyPaymentSchema.parse(payload);
        expect(parsed.receivedPaise).toBe('99900');
      });
    });

    describe('pairPosDeviceSchema', () => {
      it('validates POS device pairing with PEM key', () => {
        const pem =
          '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1234567890abcdef1234567890abcdef\n1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef==\n-----END PUBLIC KEY-----';
        const payload = {
          outletId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
          deviceName: 'Counter Register 1',
          devicePublicKeyPem: pem,
          clientTelemetry: {
            androidVersion: '14',
            appVersion: '1.2.0',
            deviceModel: 'Samsung Galaxy Tab A9',
          },
        };

        const parsed = pairPosDeviceSchema.parse(payload);
        expect(parsed.deviceName).toBe('Counter Register 1');
      });
    });
  });

  describe('Isolation of Legacy Floating-Point Currency Utilities (Finding 4)', () => {
    it('guarantees subscription financial operations and DTOs NEVER call legacy float converters', () => {
      const rupeesToPaiseSpy = vi.spyOn(currencyModule, 'rupeesToPaise');
      const paiseToRupeesSpy = vi.spyOn(currencyModule, 'paiseToRupees');

      // 1. Currency Math execution
      const sum = addPaise('14900', '100');
      expect(sum).toBe(15000n);

      const diff = subtractPaise('15000', '100');
      expect(diff).toBe(14900n);

      const prod = multiplyPaise('14900', 2);
      expect(prod).toBe(29800n);

      const tax = calculateTaxPaise('14900', 18);
      expect(tax).toBe(2682n);

      const breakdown = calculateInvoiceBreakdown('14900', 18);
      expect(breakdown.totalPaise).toBe(17582n);

      const formatted = formatINR(14900n);
      expect(formatted).toBe('₹149.00');

      // 2. DTO Transformations
      const paiseDto = formatPaiseDto(14900n);
      expect(paiseDto.amountPaise).toBe('14900');

      const priceDto = toPlanPriceDto({
        id: 'price-1',
        planId: 'plan-1',
        billingCycle: 'MONTHLY',
        currency: 'INR',
        amountPaise: 14900n,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(priceDto.amountPaise).toBe('14900');

      const invoiceDto = toSubscriptionInvoiceDto({
        id: 'inv-1',
        tenantId: 't-1',
        subscriptionId: 's-1',
        invoiceNumber: 'INV-01',
        billingCycle: 'MONTHLY',
        subtotalPaise: 14900n,
        taxRate: 18,
        taxPaise: 2682n,
        totalPaise: 17582n,
        currency: 'INR',
        status: 'ISSUED',
        dueDate: new Date(),
        paidAt: null,
      });
      expect(invoiceDto.totalPaise).toBe('17582');

      const paymentDto = toSubscriptionPaymentDto({
        id: 'pay-1',
        invoiceId: 'inv-1',
        amountPaise: 17582n,
        referenceNumber: 'UTR123456789',
        method: 'UPI',
        status: 'VERIFIED',
      });
      expect(paymentDto.amountPaise).toBe('17582');

      // Strictly verify ZERO calls to legacy float converters
      expect(rupeesToPaiseSpy).not.toHaveBeenCalled();
      expect(paiseToRupeesSpy).not.toHaveBeenCalled();

      rupeesToPaiseSpy.mockRestore();
      paiseToRupeesSpy.mockRestore();
    });

    it('preserves legacy float converters for legacy checkout compatibility', () => {
      expect(rupeesToPaise(149)).toBe(14900);
      expect(rupeesToPaise(19.99)).toBe(1999);
      expect(paiseToRupees(14900)).toBe(149);
      expect(paiseToRupees(1999)).toBe(19.99);
    });

    it('demonstrates pure BigInt financial precision avoiding IEEE 754 float drift', () => {
      // Float calculation drift example: 1.14 * 100 in float math
      const floatPaise = 1.14 * 100;
      expect(floatPaise).toBe(113.99999999999999); // IEEE 754 drift!

      // Subscription BigInt calculation: exact integer paise
      const exactBigIntPaise = toBigIntPaise('114');
      expect(exactBigIntPaise).toBe(114n); // Zero float drift

      // Large financial value exceeding Number.MAX_SAFE_INTEGER
      const largePaise = 10_000_000_000_000_001n;
      // In float Number, this truncates to 10000000000000000
      expect(Number(largePaise)).toBe(10000000000000000);

      // In Subscription DTO, exact precision is preserved
      const dto = formatPaiseDto(largePaise);
      expect(dto.amountPaise).toBe('10000000000000001');
      expect(dto.amountPaise).not.toBe('10000000000000000');
    });
  });
});
