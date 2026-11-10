import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizeEmail, normalizeIdentifier } from '../src/utils/phone.js';

describe('Phone & Email Normalization Utilities', () => {
  describe('normalizePhone', () => {
    it('preserves valid E.164 phone numbers with +', () => {
      expect(normalizePhone('+918380989776')).toBe('+918380989776');
      expect(normalizePhone('+14155552671')).toBe('+14155552671');
      expect(normalizePhone('+442071838750')).toBe('+442071838750');
    });

    it('normalizes 10-digit Indian numbers without country code to +91', () => {
      expect(normalizePhone('8380989776')).toBe('+918380989776');
      expect(normalizePhone('9876543210')).toBe('+919876543210');
    });

    it('normalizes 11-digit numbers with leading 0 trunk prefix to +91', () => {
      expect(normalizePhone('08380989776')).toBe('+918380989776');
      expect(normalizePhone('09876543210')).toBe('+919876543210');
    });

    it('normalizes 12-digit Indian numbers starting with 91 without +', () => {
      expect(normalizePhone('918380989776')).toBe('+918380989776');
      expect(normalizePhone('919876543210')).toBe('+919876543210');
    });

    it('strips whitespace, dashes, and parentheses from formatted numbers', () => {
      expect(normalizePhone('+91 83809 89776')).toBe('+918380989776');
      expect(normalizePhone('+91-83809-89776')).toBe('+918380989776');
      expect(normalizePhone('+91 (83809) 89776')).toBe('+918380989776');
      expect(normalizePhone(' 83809 89776 ')).toBe('+918380989776');
      expect(normalizePhone('83809-89776')).toBe('+918380989776');
    });

    it('returns null for invalid or non-string inputs', () => {
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone('   ')).toBeNull();
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
      expect(normalizePhone(12345)).toBeNull();
      expect(normalizePhone('123')).toBeNull();
      expect(normalizePhone('invalid-phone')).toBeNull();
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases and trims email addresses', () => {
      expect(normalizeEmail('  Test@Store.COM  ')).toBe('test@store.com');
      expect(normalizeEmail('OWNER@EXAMPLE.COM')).toBe('owner@example.com');
      expect(normalizeEmail('test.user+tag@sub.domain.co.in')).toBe(
        'test.user+tag@sub.domain.co.in'
      );
    });

    it('returns null for invalid emails or non-strings', () => {
      expect(normalizeEmail('')).toBeNull();
      expect(normalizeEmail('invalid')).toBeNull();
      expect(normalizeEmail('missing-domain@')).toBeNull();
      expect(normalizeEmail(null)).toBeNull();
      expect(normalizeEmail(undefined)).toBeNull();
    });
  });

  describe('normalizeIdentifier', () => {
    it('identifies and normalizes phone numbers', () => {
      const res = normalizeIdentifier('8380989776');
      expect(res.phone).toBe('+918380989776');
      expect(res.email).toBeNull();
      expect(res.rawTrimmed).toBe('8380989776');
    });

    it('identifies and normalizes formatted phone numbers', () => {
      const res = normalizeIdentifier(' +91 83809 89776 ');
      expect(res.phone).toBe('+918380989776');
      expect(res.email).toBeNull();
      expect(res.rawTrimmed).toBe('+91 83809 89776');
    });

    it('identifies and normalizes email addresses', () => {
      const res = normalizeIdentifier('  Owner@Store.com ');
      expect(res.email).toBe('owner@store.com');
      expect(res.phone).toBeNull();
      expect(res.rawTrimmed).toBe('Owner@Store.com');
    });

    it('handles null and empty values gracefully', () => {
      expect(normalizeIdentifier('')).toEqual({ email: null, phone: null, rawTrimmed: '' });
      expect(normalizeIdentifier(null)).toEqual({ email: null, phone: null, rawTrimmed: '' });
    });
  });
});
