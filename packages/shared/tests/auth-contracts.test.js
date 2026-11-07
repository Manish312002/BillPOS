import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  passwordPolicySchema,
  superadminLoginSchema,
  totpVerificationSchema,
  totpEnrollmentConfirmSchema,
  totpRecoveryVerifySchema,
  createTenantSchema,
  ownerActivationSchema,
  ownerLoginSchema,
} from '../src/contracts/auth.contracts.js';

describe('Shared Authentication Contracts & Validation Schemas (ADR-002)', () => {
  describe('phoneSchema', () => {
    it('accepts valid E.164 phone numbers', () => {
      expect(phoneSchema.parse('+918380989776')).toBe('+918380989776');
      expect(phoneSchema.parse('+14155552671')).toBe('+14155552671');
    });

    it('rejects invalid or non-E.164 phone numbers', () => {
      expect(() => phoneSchema.parse('8380989776')).toThrow();
      expect(() => phoneSchema.parse('+012345')).toThrow(); // Leading 0 invalid
      expect(() => phoneSchema.parse('invalid')).toThrow();
    });
  });

  describe('passwordPolicySchema', () => {
    it('accepts strong passwords meeting all complexity criteria', () => {
      expect(passwordPolicySchema.parse('SuperAdmin@BillingBuddy2026!')).toBe(
        'SuperAdmin@BillingBuddy2026!'
      );
    });

    it('rejects weak or non-compliant passwords', () => {
      expect(() => passwordPolicySchema.parse('short1!')).toThrow(/at least 10 characters/i);
      expect(() => passwordPolicySchema.parse('alllowercase123!@#')).toThrow(/uppercase/i);
      expect(() => passwordPolicySchema.parse('ALLUPPERCASE123!@#')).toThrow(/lowercase/i);
      expect(() => passwordPolicySchema.parse('NoDigitsHere!@#')).toThrow(/digit/i);
      expect(() => passwordPolicySchema.parse('NoSymbols123456')).toThrow(/special symbol/i);
    });
  });

  describe('superadminLoginSchema', () => {
    it('accepts valid login payloads with phone or email', () => {
      const parsed1 = superadminLoginSchema.parse({
        identifier: '+918380989776',
        password: 'ValidPassword123!',
      });
      expect(parsed1.identifier).toBe('+918380989776');

      const parsed2 = superadminLoginSchema.parse({
        identifier: 'admin@billingbuddy.com',
        password: 'ValidPassword123!',
      });
      expect(parsed2.identifier).toBe('admin@billingbuddy.com');
    });

    it('rejects missing or empty identifiers and passwords', () => {
      expect(() => superadminLoginSchema.parse({ identifier: '', password: '123' })).toThrow();
      expect(() => superadminLoginSchema.parse({ identifier: 'admin', password: '' })).toThrow();
    });
  });

  describe('totpVerificationSchema', () => {
    it('accepts valid 6-digit numeric TOTP codes', () => {
      const parsed = totpVerificationSchema.parse({ code: '582910' });
      expect(parsed.code).toBe('582910');
    });

    it('rejects non-numeric, 5-digit, or 7-digit TOTP codes', () => {
      expect(() => totpVerificationSchema.parse({ code: '12345' })).toThrow(/exactly 6 digits/i);
      expect(() => totpVerificationSchema.parse({ code: '1234567' })).toThrow(/exactly 6 digits/i);
      expect(() => totpVerificationSchema.parse({ code: '12345a' })).toThrow(/numerical digits/i);
    });
  });

  describe('totpEnrollmentConfirmSchema', () => {
    it('accepts valid Base32 secret and 6-digit TOTP code', () => {
      const parsed = totpEnrollmentConfirmSchema.parse({
        secret: 'JBSWY3DPEHPK3PXP',
        code: '123456',
      });
      expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(parsed.code).toBe('123456');
    });

    it('rejects non-Base32 secrets or invalid codes', () => {
      expect(() =>
        totpEnrollmentConfirmSchema.parse({
          secret: 'invalid-base32-0189', // 0, 1, 8, 9 not in Base32
          code: '123456',
        })
      ).toThrow();
    });
  });

  describe('totpRecoveryVerifySchema', () => {
    it('accepts valid 128-bit formatted recovery code', () => {
      const parsed = totpRecoveryVerifySchema.parse({
        recoveryCode: 'A1B2C3D4-E5F6A7B8-9C0D1E2F-3A4B5C6D',
      });
      expect(parsed.recoveryCode).toBe('A1B2C3D4-E5F6A7B8-9C0D1E2F-3A4B5C6D');
    });

    it('rejects short or empty recovery codes', () => {
      expect(() => totpRecoveryVerifySchema.parse({ recoveryCode: 'short' })).toThrow();
      expect(() => totpRecoveryVerifySchema.parse({ recoveryCode: '' })).toThrow();
    });
  });

  describe('createTenantSchema', () => {
    it('accepts valid tenant creation payload with normalized slug and phone', () => {
      const payload = {
        legalName: 'Metro Supermarkets Private Limited',
        tradeName: 'Metro Mart',
        slug: 'metro-mart-pune',
        ownerPhone: '+919876543210',
        ownerEmail: 'owner@metromart.com',
        ownerFullName: 'Rajesh Sharma',
      };
      const parsed = createTenantSchema.parse(payload);
      expect(parsed.slug).toBe('metro-mart-pune');
      expect(parsed.ownerEmail).toBe('owner@metromart.com');
    });

    it('rejects invalid slug formats', () => {
      const payload = {
        legalName: 'Metro Supermarkets',
        slug: 'Metro Mart Invalid', // Spaces and uppercase
        ownerPhone: '+919876543210',
        ownerEmail: 'owner@metromart.com',
        ownerFullName: 'Rajesh Sharma',
      };
      expect(() => createTenantSchema.parse(payload)).toThrow(
        /Slug must be lowercase alphanumeric/i
      );
    });
  });

  describe('ownerActivationSchema', () => {
    it('accepts valid activation payload with token and compliant password (no OTP required)', () => {
      const payload = {
        token: 'opaque_invitation_token_with_sufficient_length_123',
        password: 'NewOwnerSecurePassword2026!',
      };
      const parsed = ownerActivationSchema.parse(payload);
      expect(parsed.token).toBe('opaque_invitation_token_with_sufficient_length_123');
      expect(parsed.password).toBe('NewOwnerSecurePassword2026!');
    });

    it('rejects weak passwords during owner activation', () => {
      const payload = {
        token: 'opaque_invitation_token_with_sufficient_length_123',
        password: 'weak',
      };
      expect(() => ownerActivationSchema.parse(payload)).toThrow(/at least 10 characters/i);
    });
  });

  describe('ownerLoginSchema', () => {
    it('accepts valid owner login payload with optional tenant slug', () => {
      const payload = {
        identifier: 'owner@metromart.com',
        password: 'OwnerPassword123!',
        tenantSlug: 'metro-mart-pune',
      };
      const parsed = ownerLoginSchema.parse(payload);
      expect(parsed.tenantSlug).toBe('metro-mart-pune');
    });
  });
});
