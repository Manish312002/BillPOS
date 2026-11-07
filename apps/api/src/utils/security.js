import crypto from 'crypto';
import { env } from '../config/env.js';

// Approved OTP Security Policies
export const OTP_LENGTH = 6;
export const OTP_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_MAX_ATTEMPTS = 3; // Maximum 3 attempts per challenge
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 * Generates uniformly distributed integer in [100000, 999999].
 *
 * @returns {string} 6-digit OTP string
 */
export function generateOtp() {
  const otpNumber = crypto.randomInt(100000, 1000000);
  return otpNumber.toString();
}

/**
 * Computes a keyed HMAC-SHA256 digest of the given OTP using the server-side pepper secret.
 * This protects against lookup table / dictionary attacks on the 6-digit search space.
 *
 * @param {string} otp - 6-digit OTP
 * @param {string} [pepper=env.OTP_PEPPER_SECRET] - Cryptographic pepper secret
 * @returns {string} Hex-encoded HMAC-SHA256 digest
 */
export function computeOtpDigest(otp, pepper = env.OTP_PEPPER_SECRET) {
  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    throw new Error('OTP must be a valid 6-digit numerical string');
  }
  if (!pepper || typeof pepper !== 'string' || pepper.length < 16) {
    throw new Error('Cryptographic pepper secret must be at least 16 characters long');
  }

  return crypto.createHmac('sha256', pepper).update(otp.trim()).digest('hex');
}

/**
 * Verifies a submitted OTP against a stored HMAC-SHA256 digest using constant-time comparison.
 * Prevents timing side-channel attacks.
 *
 * @param {string} submittedOtp - User-submitted OTP string
 * @param {string} storedDigest - Stored HMAC-SHA256 digest from database
 * @param {string} [pepper=env.OTP_PEPPER_SECRET] - Cryptographic pepper secret
 * @returns {boolean} True if submitted OTP matches digest, false otherwise
 */
export function verifyOtpDigest(submittedOtp, storedDigest, pepper = env.OTP_PEPPER_SECRET) {
  if (
    !submittedOtp ||
    typeof submittedOtp !== 'string' ||
    !storedDigest ||
    typeof storedDigest !== 'string'
  ) {
    return false;
  }

  try {
    const computedDigest = computeOtpDigest(submittedOtp, pepper);
    const computedBuffer = Buffer.from(computedDigest, 'hex');
    const storedBuffer = Buffer.from(storedDigest, 'hex');

    if (computedBuffer.length !== storedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, storedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generates an opaque, cryptographically secure random token (e.g. for sessions or invitations).
 *
 * @param {number} [byteLength=32] - Number of random bytes (default 32 = 256 bits entropy)
 * @returns {string} URL-safe Base64 string
 */
export function generateOpaqueToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * Computes a standard SHA-256 hash of an opaque token for database storage.
 * Ensures plaintext tokens are never stored in the database.
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
 * Calculates the expiration timestamp for a newly created OTP challenge (T + 5 minutes).
 *
 * @param {Date} [fromTime=new Date()]
 * @returns {Date}
 */
export function calculateOtpExpiry(fromTime = new Date()) {
  return new Date(fromTime.getTime() + OTP_VALIDITY_MS);
}

/**
 * Calculates the earliest time a resend request can be processed (T + 60 seconds).
 *
 * @param {Date} [fromTime=new Date()]
 * @returns {Date}
 */
export function calculateOtpResendAvailable(fromTime = new Date()) {
  return new Date(fromTime.getTime() + OTP_RESEND_COOLDOWN_MS);
}

/**
 * Checks whether an OTP has expired.
 *
 * @param {Date|string} expiresAt
 * @param {Date} [currentTime=new Date()]
 * @returns {boolean}
 */
export function isOtpExpired(expiresAt, currentTime = new Date()) {
  const expiryDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return currentTime.getTime() > expiryDate.getTime();
}

/**
 * Checks whether an OTP resend cooldown is currently active.
 *
 * @param {Date|string} resendAvailableAt
 * @param {Date} [currentTime=new Date()]
 * @returns {boolean}
 */
export function isResendCooldownActive(resendAvailableAt, currentTime = new Date()) {
  const availableDate =
    resendAvailableAt instanceof Date ? resendAvailableAt : new Date(resendAvailableAt);
  return currentTime.getTime() < availableDate.getTime();
}

/**
 * Returns remaining cooldown time in integer seconds.
 *
 * @param {Date|string} resendAvailableAt
 * @param {Date} [currentTime=new Date()]
 * @returns {number} Seconds remaining (0 if cooldown has passed)
 */
export function getRemainingCooldownSeconds(resendAvailableAt, currentTime = new Date()) {
  const availableDate =
    resendAvailableAt instanceof Date ? resendAvailableAt : new Date(resendAvailableAt);
  const remainingMs = availableDate.getTime() - currentTime.getTime();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Lightweight sliding-window rate limiter and cooldown tracker.
 */
export class RateLimiter {
  constructor({ windowMs = 60000, maxRequests = 5 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  /**
   * Records a request hit and returns whether the key is within rate limits.
   *
   * @param {string} key - Identifier (e.g. phone, IP, or user ID)
   * @returns {{ isAllowed: boolean, remaining: number, resetInMs: number }}
   */
  consume(key) {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter((time) => now - time < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const resetInMs = this.windowMs - (now - oldest);
      return {
        isAllowed: false,
        remaining: 0,
        resetInMs: Math.max(resetInMs, 0),
      };
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);

    return {
      isAllowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetInMs: this.windowMs,
    };
  }

  /**
   * Resets rate limit records for a key.
   *
   * @param {string} key
   */
  reset(key) {
    this.hits.delete(key);
  }

  /**
   * Cleans up expired entries across the map.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((time) => now - time < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }
}
