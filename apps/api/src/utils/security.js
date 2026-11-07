import crypto from 'crypto';
import bcrypt from 'bcrypt';

export const BCRYPT_SALT_ROUNDS = 12;

/**
 * Validates password strength policy:
 * - Minimum 10 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 * - At least 1 special symbol
 *
 * @param {string} password
 * @returns {boolean} True if compliant, throws Error otherwise
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
 * Hashes a plaintext password using native bcrypt with cost factor 12.
 *
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} Standard bcrypt hash string ($2b$12$...)
 */
export async function hashPassword(password) {
  validatePasswordPolicy(password);
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash using constant-time comparison.
 *
 * @param {string} password - Plaintext password
 * @param {string} hash - Stored bcrypt hash
 * @returns {Promise<boolean>} True if match, false otherwise
 */
export async function verifyPassword(password, hash) {
  if (!password || typeof password !== 'string' || !hash || typeof hash !== 'string') {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * Generates an opaque, cryptographically secure random token (e.g. for sessions or invitations).
 * Default 32 bytes provides 256 bits of entropy.
 *
 * @param {number} [byteLength=32] - Number of random bytes
 * @returns {string} URL-safe Base64 string
 */
export function generateOpaqueToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * Computes a standard SHA-256 hash of an opaque token for database storage.
 * Ensures plaintext tokens delivered to cookies or URL links are never stored in the database.
 *
 * @param {string} token - Opaque token string
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Compares two strings in constant time to prevent timing side-channel attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean} True if strings are strictly equal
 */
export function verifyTimingSafe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Re-export TOTP Secret Encryption at Rest utilities
export { encryptTotpSecret, decryptTotpSecret, validateEncryptionKey } from './totp.js';
