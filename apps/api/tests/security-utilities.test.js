import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateOtp,
  computeOtpDigest,
  verifyOtpDigest,
  generateOpaqueToken,
  hashToken,
  calculateOtpExpiry,
  calculateOtpResendAvailable,
  isOtpExpired,
  isResendCooldownActive,
  getRemainingCooldownSeconds,
  RateLimiter,
  OTP_LENGTH,
  OTP_VALIDITY_MS,
  OTP_RESEND_COOLDOWN_MS,
} from '../src/utils/security.js';
import {
  WhatsAppProvider,
  MockWhatsAppProvider,
  getWhatsAppProvider,
} from '../src/services/whatsapp/index.js';

describe('Cryptographic OTP Generation & Digest Security', () => {
  const testPepper = 'test_cryptographic_pepper_secret_key_12345';

  it('generates a cryptographically random 6-digit numeric OTP within [100000, 999999]', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp();
      expect(otp).toHaveLength(OTP_LENGTH);
      expect(otp).toMatch(/^\d{6}$/);
      const num = parseInt(otp, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  it('computes deterministic HMAC-SHA256 digests with a pepper secret', () => {
    const otp = '849201';
    const digest1 = computeOtpDigest(otp, testPepper);
    const digest2 = computeOtpDigest(otp, testPepper);

    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64); // 32 bytes in hex = 64 characters
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests when different pepper secrets are used', () => {
    const otp = '849201';
    const digestA = computeOtpDigest(otp, testPepper);
    const digestB = computeOtpDigest(otp, 'different_pepper_secret_for_comparison_999');

    expect(digestA).not.toBe(digestB);
  });

  it('rejects invalid OTP formats or insecure peppers in computeOtpDigest', () => {
    expect(() => computeOtpDigest('12345', testPepper)).toThrow(/6-digit numerical string/i);
    expect(() => computeOtpDigest('1234567', testPepper)).toThrow(/6-digit numerical string/i);
    expect(() => computeOtpDigest('abcdef', testPepper)).toThrow(/6-digit numerical string/i);
    expect(() => computeOtpDigest('123456', 'short')).toThrow(/at least 16 characters/i);
  });

  it('verifies valid OTP digests correctly using constant-time comparison', () => {
    const otp = '592014';
    const digest = computeOtpDigest(otp, testPepper);

    expect(verifyOtpDigest(otp, digest, testPepper)).toBe(true);
  });

  it('rejects incorrect OTPs and timing mismatches', () => {
    const otp = '592014';
    const digest = computeOtpDigest(otp, testPepper);

    // Completely wrong OTP
    expect(verifyOtpDigest('123456', digest, testPepper)).toBe(false);
    // Off by one digit
    expect(verifyOtpDigest('592015', digest, testPepper)).toBe(false);
    // Wrong pepper
    expect(verifyOtpDigest(otp, digest, 'wrong_pepper_secret_for_verification_888')).toBe(false);
    // Null, empty, or malformed inputs
    expect(verifyOtpDigest('', digest, testPepper)).toBe(false);
    expect(verifyOtpDigest(null, digest, testPepper)).toBe(false);
    expect(verifyOtpDigest(otp, '', testPepper)).toBe(false);
    expect(verifyOtpDigest(otp, null, testPepper)).toBe(false);
  });
});

describe('Opaque Token Generation & SHA-256 Hashing', () => {
  it('generates high-entropy base64url random tokens', () => {
    const token1 = generateOpaqueToken();
    const token2 = generateOpaqueToken();

    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThanOrEqual(40); // 32 bytes in base64url = ~43 chars
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('computes deterministic SHA-256 token hashes for database storage', () => {
    const token = 'my_secure_opaque_session_token_example_123';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws when hashing an empty or invalid token', () => {
    expect(() => hashToken('')).toThrow(/non-empty string/i);
    expect(() => hashToken(null)).toThrow(/non-empty string/i);
  });
});

describe('OTP Expiration & Resend Cooldown Policies', () => {
  it('calculates 5-minute expiry and 60-second resend availability timestamps', () => {
    const baseTime = new Date('2026-11-07T12:00:00.000Z');
    const expiry = calculateOtpExpiry(baseTime);
    const resend = calculateOtpResendAvailable(baseTime);

    expect(expiry.getTime() - baseTime.getTime()).toBe(OTP_VALIDITY_MS);
    expect(resend.getTime() - baseTime.getTime()).toBe(OTP_RESEND_COOLDOWN_MS);
  });

  it('correctly determines whether an OTP challenge is expired', () => {
    const expiry = new Date('2026-11-07T12:05:00.000Z');

    expect(isOtpExpired(expiry, new Date('2026-11-07T12:04:59.000Z'))).toBe(false);
    expect(isOtpExpired(expiry, new Date('2026-11-07T12:05:01.000Z'))).toBe(true);
  });

  it('correctly determines whether resend cooldown is active and calculates remaining seconds', () => {
    const resendAt = new Date('2026-11-07T12:01:00.000Z');

    expect(isResendCooldownActive(resendAt, new Date('2026-11-07T12:00:30.000Z'))).toBe(true);
    expect(getRemainingCooldownSeconds(resendAt, new Date('2026-11-07T12:00:30.000Z'))).toBe(30);

    expect(isResendCooldownActive(resendAt, new Date('2026-11-07T12:01:01.000Z'))).toBe(false);
    expect(getRemainingCooldownSeconds(resendAt, new Date('2026-11-07T12:01:01.000Z'))).toBe(0);
  });
});

describe('In-Memory Sliding-Window RateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
  });

  it('allows requests within the configured threshold and blocks subsequent ones', () => {
    const key = 'user_ip_127_0_0_1';
    expect(limiter.consume(key).isAllowed).toBe(true);
    expect(limiter.consume(key).isAllowed).toBe(true);
    expect(limiter.consume(key).isAllowed).toBe(true);

    // 4th request exceeds maxRequests = 3
    const blocked = limiter.consume(key);
    expect(blocked.isAllowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetInMs).toBeGreaterThan(0);
  });

  it('resets tracking when explicit reset is called', () => {
    const key = 'phone_+918380989776';
    limiter.consume(key);
    limiter.consume(key);
    limiter.consume(key);
    expect(limiter.consume(key).isAllowed).toBe(false);

    limiter.reset(key);
    expect(limiter.consume(key).isAllowed).toBe(true);
  });
});

describe('WhatsApp Provider Abstraction & Mock Provider Behavior', () => {
  it('throws when abstract WhatsAppProvider methods are invoked directly', async () => {
    const base = new WhatsAppProvider();
    await expect(base.sendOtpMessage()).rejects.toThrow(/must be implemented/i);
    await expect(base.sendInvitationMessage()).rejects.toThrow(/must be implemented/i);
  });

  it('MockWhatsAppProvider queues dispatched messages in memory without throwing', async () => {
    const mock = new MockWhatsAppProvider();
    const result = await mock.sendOtpMessage({
      destination: '+918380989776',
      otp: '749201',
      purpose: 'SUPERADMIN_LOGIN',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^mock_wa_/);

    const sent = mock.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].destination).toBe('+918380989776');
    expect(sent[0].purpose).toBe('SUPERADMIN_LOGIN');
    expect(sent[0]._otpForTesting).toBe('749201');

    const last = mock.getLastMessageFor('+918380989776');
    expect(last.messageId).toBe(result.messageId);

    mock.clearMessages();
    expect(mock.getSentMessages()).toHaveLength(0);
  });

  it('MockWhatsAppProvider dispatches invitation messages with store details', async () => {
    const mock = new MockWhatsAppProvider();
    const result = await mock.sendInvitationMessage({
      destination: '+919876543210',
      storeName: 'Royal Supermarket',
      invitationLink: 'http://localhost:5173/activate-owner/token123',
      otp: '123456',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^mock_inv_/);

    const last = mock.getLastMessageFor('+919876543210');
    expect(last.storeName).toBe('Royal Supermarket');
    expect(last.invitationLink).toContain('token123');
  });

  it('MockWhatsAppProvider supports simulateFailureNext to test error handling', async () => {
    const mock = new MockWhatsAppProvider();
    mock.simulateFailureNext('Upstream telecom network timeout');

    await expect(
      mock.sendOtpMessage({
        destination: '+918380989776',
        otp: '123456',
        purpose: 'SUPERADMIN_LOGIN',
      })
    ).rejects.toThrow(/Simulated delivery failure: Upstream telecom network timeout/i);

    // Subsequent request should succeed since failure was single-use
    const retry = await mock.sendOtpMessage({
      destination: '+918380989776',
      otp: '123456',
      purpose: 'SUPERADMIN_LOGIN',
    });
    expect(retry.success).toBe(true);
  });

  it('getWhatsAppProvider factory resolves MockWhatsAppProvider by default', () => {
    const provider = getWhatsAppProvider({ provider: 'mock' });
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
  });

  it('getWhatsAppProvider fails safely when external provider is requested without API key', () => {
    expect(() => getWhatsAppProvider({ provider: 'meta', apiKey: null })).toThrow(
      /WHATSAPP_API_KEY.*missing/i
    );
    expect(() => getWhatsAppProvider({ provider: 'twilio', apiKey: '' })).toThrow(
      /WHATSAPP_API_KEY.*missing/i
    );
  });

  it('getWhatsAppProvider rejects unknown provider types', () => {
    expect(() => getWhatsAppProvider({ provider: 'invalid_unsupported_channel' })).toThrow(
      /Unknown WhatsApp provider type/i
    );
  });
});
