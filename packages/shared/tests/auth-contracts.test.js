import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  passwordPolicySchema,
  superadminLoginSchema,
  otpVerificationSchema,
  createTenantSchema,
  ownerActivationSchema,
  ownerLoginSchema,
} from '../src/contracts/auth.contracts.js';

describe('Shared Authentication Contracts & Validation Schemas', () => {
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

  describe('otpVerificationSchema', () => {
    it('accepts valid challenge UUID and 6-digit numeric OTP', () => {
      const payload = {
        challengeId: '2e0d6b46-3e86-4e55-9561-70edda2920bd',
        otp: '582910',
      };
      const parsed = otpVerificationSchema.parse(payload);
      expect(parsed.otp).toBe('582910');
    });

    it('rejects non-numeric, 5-digit, 7-digit, or malformed OTPs', () => {
      const validUUID = '2e0d6b46-3e86-4e55-9561-70edda2920bd';
      expect(() => otpVerificationSchema.parse({ challengeId: validUUID, otp: '12345' })).toThrow(
        /exactly 6 digits/i
      );
      expect(() => otpVerificationSchema.parse({ challengeId: validUUID, otp: '1234567' })).toThrow(
        /exactly 6 digits/i
      );
      expect(() => otpVerificationSchema.parse({ challengeId: validUUID, otp: '12345a' })).toThrow(
        /numerical digits/i
      );
      expect(() =>
        otpVerificationSchema.parse({ challengeId: 'invalid-uuid', otp: '123456' })
      ).toThrow(/Valid challenge UUID/i);
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
    it('accepts valid activation payload with token, 6-digit OTP, and compliant password', () => {
      const payload = {
        token: 'opaque_invitation_token_with_sufficient_length_123',
        otp: '654321',
        password: 'NewOwnerSecurePassword2026!',
      };
      const parsed = ownerActivationSchema.parse(payload);
      expect(parsed.otp).toBe('654321');
    });

    it('rejects weak passwords during owner activation', () => {
      const payload = {
        token: 'opaque_invitation_token_with_sufficient_length_123',
        otp: '654321',
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
