/**
 * BillingBuddy — Phone & Identity Normalization Utilities
 *
 * Implements canonical E.164 phone normalization with Indian (+91) domestic mobile handling
 * and case-insensitive email normalization for authentication and tenant provisioning.
 */

/**
 * Normalizes a phone number into canonical E.164 international format (+918380989776).
 *
 * Handles:
 * - Indian 10-digit mobile numbers without country code (e.g. "8380989776" -> "+918380989776")
 * - 11-digit numbers with leading 0 (e.g. "08380989776" -> "+918380989776")
 * - 12-digit numbers with Indian country code without '+' (e.g. "918380989776" -> "+918380989776")
 * - Formatted numbers with spaces, dashes, brackets (e.g. "+91 83809-89776" -> "+918380989776")
 * - International E.164 numbers (e.g. "+14155552671" -> "+14155552671")
 *
 * @param {string} rawPhone - Raw phone input
 * @returns {string|null} Canonical E.164 phone string, or null if invalid
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return null;
  }

  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return null;
  }

  // Already prefixed with '+'
  if (trimmed.startsWith('+')) {
    const cleaned = '+' + trimmed.slice(1).replace(/[\s\-().]/g, '');
    if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  // Digits only
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    // 10-digit Indian domestic mobile number
    return `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    // 11-digit with leading trunk 0
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    // 12-digit Indian number starting with 91 without '+'
    return `+${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    // Fallback international number without '+'
    return `+${digits}`;
  }

  return null;
}

/**
 * Normalizes an email address: trims whitespace and lowercases.
 *
 * @param {string} rawEmail - Raw email input
 * @returns {string|null} Normalized lowercase email, or null if invalid
 */
export function normalizeEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return null;
  }

  const trimmed = rawEmail.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  // RFC 5322 compliant basic check
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Analyzes and normalizes a login identifier into candidate email and/or phone.
 *
 * @param {string} rawIdentifier - User-provided phone or email identifier
 * @returns {{ email: string|null, phone: string|null, rawTrimmed: string }}
 */
export function normalizeIdentifier(rawIdentifier) {
  if (!rawIdentifier || typeof rawIdentifier !== 'string') {
    return { email: null, phone: null, rawTrimmed: '' };
  }

  const rawTrimmed = rawIdentifier.trim();
  const email = rawTrimmed.includes('@') ? normalizeEmail(rawTrimmed) : null;
  const phone = normalizePhone(rawTrimmed);

  return { email, phone, rawTrimmed };
}
