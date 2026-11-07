import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/config/env.js';
import {
  generateTotpSecret,
  computeTotpCode,
  verifyTotpCode,
  generateTotpUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  base32Encode,
  base32Decode,
  encryptTotpSecret,
  decryptTotpSecret,
  validateEncryptionKey,
} from '../src/utils/totp.js';
import {
  normalizeWhatsAppPhone,
  generateInvitationMessage,
  generateWhatsAppLink,
} from '../src/utils/whatsapp.js';
import {
  generateOpaqueToken,
  hashToken,
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  verifyTimingSafe,
} from '../src/utils/security.js';

describe('RFC 6238 Known Test Vectors & Dynamic Truncation', () => {
  // Test secret from RFC 6238 Appendix B: ASCII "12345678901234567890"
  // Hex: 3132333435363738393031323334353637383930
  // Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches RFC 6238 Appendix B test vector at Time = 59s', () => {
    // 59 seconds = 59000 ms
    const code = computeTotpCode(rfcSecret, 59 * 1000);
    expect(code).toBe('287082');
  });

  it('matches RFC 6238 Appendix B test vector at Time = 1111111109s', () => {
    const code = computeTotpCode(rfcSecret, 1111111109 * 1000);
    expect(code).toBe('081804');
  });

  it('matches RFC 6238 Appendix B test vector at Time = 1111111111s', () => {
    const code = computeTotpCode(rfcSecret, 1111111111 * 1000);
    expect(code).toBe('050471');
  });

  it('matches RFC 6238 Appendix B test vector at Time = 1234567890s', () => {
    const code = computeTotpCode(rfcSecret, 1234567890 * 1000);
    expect(code).toBe('005924');
  });

  it('matches RFC 6238 Appendix B test vector at Time = 2000000000s', () => {
    const code = computeTotpCode(rfcSecret, 2000000000 * 1000);
    expect(code).toBe('279037');
  });
});

describe('Base32 Encoding & Secret Generation', () => {
  it('generates a 20-byte cryptographically random Base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32); // 20 bytes * 8 / 5 = 32 Base32 chars
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('correctly encodes and decodes binary buffers with roundtrip equality', () => {
    const original = Buffer.from('BillingBuddyPlatformSecret2026!');
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('rejects invalid Base32 characters like 0, 1, 8, 9', () => {
    expect(() => base32Decode('INVALID0SECRET')).toThrow(/Invalid character/);
    expect(() => base32Decode('INVALID1SECRET')).toThrow(/Invalid character/);
    expect(() => base32Decode('INVALID8SECRET')).toThrow(/Invalid character/);
    expect(() => base32Decode('INVALID9SECRET')).toThrow(/Invalid character/);
  });
});

describe('TOTP Verification & Clock-Drift Window Tolerance', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const baseTime = 1700000000000; // Fixed timestamp

  it('verifies code generated at current timestamp', () => {
    const code = computeTotpCode(secret, baseTime);
    expect(verifyTotpCode(code, secret, { timestamp: baseTime, window: 1 })).toBe(true);
  });

  it('tolerates backward clock drift of 1 step (-30 seconds)', () => {
    const pastCode = computeTotpCode(secret, baseTime - 30 * 1000);
    expect(verifyTotpCode(pastCode, secret, { timestamp: baseTime, window: 1 })).toBe(true);
  });

  it('tolerates forward clock drift of 1 step (+30 seconds)', () => {
    const futureCode = computeTotpCode(secret, baseTime + 30 * 1000);
    expect(verifyTotpCode(futureCode, secret, { timestamp: baseTime, window: 1 })).toBe(true);
  });

  it('rejects code older than drift window (-60 seconds / 2 steps ago)', () => {
    const expiredCode = computeTotpCode(secret, baseTime - 60 * 1000);
    expect(verifyTotpCode(expiredCode, secret, { timestamp: baseTime, window: 1 })).toBe(false);
  });

  it('rejects code ahead of drift window (+60 seconds / 2 steps ahead)', () => {
    const tooEarlyCode = computeTotpCode(secret, baseTime + 60 * 1000);
    expect(verifyTotpCode(tooEarlyCode, secret, { timestamp: baseTime, window: 1 })).toBe(false);
  });

  it('rejects incorrect codes or invalid formats', () => {
    expect(verifyTotpCode('000000', secret, { timestamp: baseTime })).toBe(false);
    expect(verifyTotpCode('12345', secret, { timestamp: baseTime })).toBe(false);
    expect(verifyTotpCode('abcdef', secret, { timestamp: baseTime })).toBe(false);
    expect(verifyTotpCode(null, secret, { timestamp: baseTime })).toBe(false);
  });
});

describe('TOTP Provisioning URI Generation', () => {
  it('formats standard otpauth URI compatible with Google Authenticator', () => {
    const uri = generateTotpUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: '+918380989776',
      issuer: 'BillingBuddy',
    });

    expect(uri).toBe(
      'otpauth://totp/BillingBuddy:%2B918380989776?secret=JBSWY3DPEHPK3PXP&issuer=BillingBuddy&algorithm=SHA1&digits=6&period=30'
    );
  });

  it('throws if required parameters are missing', () => {
    expect(() => generateTotpUri({ secret: '', accountName: 'admin' })).toThrow(/required/i);
    expect(() => generateTotpUri({ secret: 'KEY', accountName: '' })).toThrow(/required/i);
  });
});

describe('Recovery Codes Generation & Hashing (SEC-01: 128-bit Entropy)', () => {
  it('generates the specified count of unique formatted recovery codes with at least 128 bits of entropy', () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);

    const uniqueSet = new Set(codes);
    expect(uniqueSet.size).toBe(8);

    for (const code of codes) {
      // 4 hyphenated blocks of 8 hex characters: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
      expect(code).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/);

      // Verify raw bytes and cryptographic entropy: 32 hex chars = 16 bytes = 128 bits
      const rawHex = code.replace(/-/g, '');
      expect(rawHex).toHaveLength(32);
      const rawBytes = Buffer.from(rawHex, 'hex');
      expect(rawBytes.length).toBe(16);
      expect(rawBytes.length * 8).toBeGreaterThanOrEqual(128);
    }
  });

  it('hashes recovery codes deterministically using SHA-256 with case and hyphen insensitivity', () => {
    const code = 'A1B2C3D4-E5F6A7B8-9C0D1E2F-3A4B5C6D';
    const hash1 = hashRecoveryCode(code);
    const hash2 = hashRecoveryCode('a1b2c3d4-e5f6a7b8-9c0d1e2f-3a4b5c6d'); // Lowercase and hyphens
    const hash3 = hashRecoveryCode('A1B2C3D4E5F6A7B89C0D1E2F3A4B5C6D'); // Stripped hyphens
    const hash4 = hashRecoveryCode('  a1b2c3d4 e5f6a7b8 9c0d1e2f 3a4b5c6d  '); // Whitespace

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
    expect(hash1).toBe(hash4);
    expect(hash1).toHaveLength(64);
  });

  it('verifies valid recovery code against stored hashes in constant time', () => {
    const codes = generateRecoveryCodes(3);
    const hashedCodes = codes.map(hashRecoveryCode);

    const validCode = codes[1];
    const matchedHash = verifyRecoveryCode(validCode, hashedCodes);
    expect(matchedHash).toBe(hashedCodes[1]);

    const invalidCode = 'FFFF0000-11112222-33334444-55556666';
    expect(verifyRecoveryCode(invalidCode, hashedCodes)).toBeNull();
  });
});

describe('AES-256-GCM TOTP Secret Encryption at Rest (SEC-02: ADR-002)', () => {
  const testSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const custom32ByteKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('encrypts and decrypts a TOTP secret using AES-256-GCM with roundtrip equality', () => {
    const payload = encryptTotpSecret(testSecret);
    expect(payload).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

    const decrypted = decryptTotpSecret(payload);
    expect(decrypted).toBe(testSecret);
  });

  it('supports custom 32-byte hexadecimal and raw string keys', () => {
    // 64 hex characters (32 bytes)
    const payloadHex = encryptTotpSecret(testSecret, custom32ByteKey);
    const decryptedHex = decryptTotpSecret(payloadHex, custom32ByteKey);
    expect(decryptedHex).toBe(testSecret);

    // 32-byte UTF-8 string
    const stringKey = 'custom_totp_32_byte_secret_key_1';
    const payloadStr = encryptTotpSecret(testSecret, stringKey);
    const decryptedStr = decryptTotpSecret(payloadStr, stringKey);
    expect(decryptedStr).toBe(testSecret);
  });

  it('generates a fresh cryptographically random 12-byte IV for every encryption', () => {
    const payload1 = encryptTotpSecret(testSecret);
    const payload2 = encryptTotpSecret(testSecret);

    expect(payload1).not.toBe(payload2);

    const [, iv1] = payload1.split(':');
    const [, iv2] = payload2.split(':');
    expect(iv1).not.toBe(iv2);
    expect(iv1).toHaveLength(24); // 12 bytes = 24 hex chars
    expect(iv2).toHaveLength(24);
  });

  it('rejects decryption when wrong encryption key is supplied', () => {
    const payload = encryptTotpSecret(testSecret);
    const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    expect(() => decryptTotpSecret(payload, wrongKey)).toThrow(
      /authentication failed or payload corrupted/
    );
  });

  it('rejects tampered ciphertext', () => {
    const payload = encryptTotpSecret(testSecret);
    const [version, iv, tag, ct] = payload.split(':');

    // Flip first byte of ciphertext
    const tamperedCt = (ct.startsWith('aa') ? 'bb' : 'aa') + ct.slice(2);
    const tamperedPayload = [version, iv, tag, tamperedCt].join(':');

    expect(() => decryptTotpSecret(tamperedPayload)).toThrow(
      /authentication failed or payload corrupted/
    );
  });

  it('rejects tampered authentication tag', () => {
    const payload = encryptTotpSecret(testSecret);
    const [version, iv, tag, ct] = payload.split(':');

    // Flip first byte of tag
    const tamperedTag = (tag.startsWith('aa') ? 'bb' : 'aa') + tag.slice(2);
    const tamperedPayload = [version, iv, tamperedTag, ct].join(':');

    expect(() => decryptTotpSecret(tamperedPayload)).toThrow(
      /authentication failed or payload corrupted/
    );
  });

  it('rejects invalid or malformed payload structures', () => {
    expect(() => decryptTotpSecret('')).toThrow(/non-empty string/);
    expect(() => decryptTotpSecret('v1:only_two_parts')).toThrow(/invalid part structure/);
    expect(() =>
      decryptTotpSecret('v2:123456789012345678901234:12345678901234567890123456789012:abcd')
    ).toThrow(/Unsupported encryption payload version/);
    // Invalid IV length (not 24 hex chars)
    expect(() => decryptTotpSecret('v1:shortiv:12345678901234567890123456789012:abcd')).toThrow(
      /invalid 12-byte IV/
    );
    // Invalid Tag length (not 32 hex chars)
    expect(() => decryptTotpSecret('v1:123456789012345678901234:shorttag:abcd')).toThrow(
      /invalid 16-byte authentication tag/
    );
  });

  it('rejects weak or malformed encryption keys without silent key derivation', () => {
    expect(() => validateEncryptionKey(null)).toThrow(/not configured/);
    expect(() => validateEncryptionKey('')).toThrow(/not configured/);
    expect(() => validateEncryptionKey('short_key')).toThrow(/must be exactly 32 bytes/);
    expect(() => validateEncryptionKey(Buffer.alloc(16))).toThrow(/expected 32 bytes/);
    expect(() => validateEncryptionKey(12345)).toThrow(/must be a 32-byte buffer or string/);
  });

  it('rejects empty or non-string secrets to encrypt', () => {
    expect(() => encryptTotpSecret('')).toThrow(/non-empty string/);
    expect(() => encryptTotpSecret(null)).toThrow(/non-empty string/);
  });
});

describe('Environment TOTP_ENCRYPTION_KEY Configuration Validation', () => {
  const baseConfig = {
    PORT: 4000,
    NODE_ENV: 'test',
    API_PREFIX: '/api',
    CORS_ORIGIN: 'http://localhost:5173',
  };

  it('rejects environment configuration when TOTP_ENCRYPTION_KEY is missing', () => {
    const result = envSchema.safeParse({ ...baseConfig });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toContain('TOTP_ENCRYPTION_KEY');
  });

  it('rejects environment configuration when TOTP_ENCRYPTION_KEY is empty', () => {
    const result = envSchema.safeParse({ ...baseConfig, TOTP_ENCRYPTION_KEY: '' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toContain('TOTP_ENCRYPTION_KEY');
  });

  it('rejects environment configuration with the .env.example placeholder', () => {
    const result = envSchema.safeParse({
      ...baseConfig,
      TOTP_ENCRYPTION_KEY: 'replace_with_64_hex_character_secret_key_generated_via_openssl',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/must be a valid 32-byte key/);
  });

  it('accepts environment configuration with a valid 64-character hexadecimal key', () => {
    const validHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const result = envSchema.safeParse({ ...baseConfig, TOTP_ENCRYPTION_KEY: validHexKey });
    expect(result.success).toBe(true);
    expect(result.data.TOTP_ENCRYPTION_KEY).toBe(validHexKey);
  });

  it('accepts environment configuration with a valid 32-byte UTF-8 string key', () => {
    const valid32ByteKey = '12345678901234567890123456789012'; // exactly 32 bytes
    const result = envSchema.safeParse({ ...baseConfig, TOTP_ENCRYPTION_KEY: valid32ByteKey });
    expect(result.success).toBe(true);
    expect(result.data.TOTP_ENCRYPTION_KEY).toBe(valid32ByteKey);
  });
});

describe('Manual WhatsApp Click-to-Chat Link Generation (ADR-002)', () => {
  it('normalizes international phone numbers into digits-only format', () => {
    expect(normalizeWhatsAppPhone('+91 83809 89776')).toBe('918380989776');
    expect(normalizeWhatsAppPhone('+91-83809-89776')).toBe('918380989776');
    expect(normalizeWhatsAppPhone('+91 (83809) 89776')).toBe('918380989776');
    expect(normalizeWhatsAppPhone('+1 (415) 555-2671')).toBe('14155552671');
    // 10-digit Indian local mobile number defaults to 91
    expect(normalizeWhatsAppPhone('8380989776')).toBe('918380989776');
  });

  it('rejects invalid or out-of-range phone numbers', () => {
    expect(() => normalizeWhatsAppPhone('12345')).toThrow(/Invalid phone number length/);
    expect(() => normalizeWhatsAppPhone('')).toThrow(/non-empty string/);
    expect(() => normalizeWhatsAppPhone(null)).toThrow(/non-empty string/);
  });

  it('formats invitation message containing store name and activation link', () => {
    const message = generateInvitationMessage({
      ownerName: 'Rajesh Sharma',
      storeName: 'Royal Mart',
      invitationLink: 'https://app.billingbuddy.com/activate-owner/token_12345',
      expiryHours: 12,
    });

    expect(message).toContain('Hello Rajesh Sharma');
    expect(message).toContain('Royal Mart');
    expect(message).toContain('https://app.billingbuddy.com/activate-owner/token_12345');
    expect(message).toContain('12 hours');
    // Verify zero credential hashes or tokens are leaked in message body
    expect(message).not.toContain('passwordHash');
    expect(message).not.toContain('otp');
    expect(message).not.toContain('secret');
  });

  it('generates compliant wa.me Click-to-Chat deep links with URL-encoded messages', () => {
    const link = generateWhatsAppLink({
      phone: '+91 83809 89776',
      message: 'Hello Rajesh! Welcome to BillingBuddy.\nLink: https://example.com',
    });

    expect(link).toMatch(/^https:\/\/wa\.me\/918380989776\?text=/);
    expect(link).toContain(encodeURIComponent('Hello Rajesh! Welcome to BillingBuddy.'));
    expect(link).toContain(encodeURIComponent('Link: https://example.com'));
  });

  it('rejects empty or whitespace-only messages in generateWhatsAppLink', () => {
    expect(() =>
      generateWhatsAppLink({
        phone: '+918380989776',
        message: '   ',
      })
    ).toThrow(/Message text is required/);
  });
});

describe('Consolidated Security Utilities (Tokens, Hashing, Passwords)', () => {
  it('generates high-entropy base64url opaque tokens', () => {
    const token1 = generateOpaqueToken(32);
    const token2 = generateOpaqueToken(32);

    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThanOrEqual(40);
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('computes deterministic SHA-256 token hashes', () => {
    const token = 'sample_invitation_bearer_token_12345';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes passwords using native bcrypt 12 rounds and verifies correctly', async () => {
    const password = 'SuperAdmin@BillingBuddy2026!';
    const hash = await hashPassword(password);

    expect(hash).toMatch(/^\$2[aby]\$12\$/);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);

    const isWrong = await verifyPassword('WrongPassword123!', hash);
    expect(isWrong).toBe(false);
  });

  it('enforces password policy complexity rules in hashPassword and validatePasswordPolicy', async () => {
    expect(validatePasswordPolicy('SuperAdmin@BillingBuddy2026!')).toBe(true);
    await expect(hashPassword('short1!')).rejects.toThrow(/at least 10 characters/);
    await expect(hashPassword('alllowercase123!@#')).rejects.toThrow(/uppercase/);
    await expect(hashPassword('ALLUPPERCASE123!@#')).rejects.toThrow(/lowercase/);
    await expect(hashPassword('NoDigitsHere!@#')).rejects.toThrow(/digit/);
    await expect(hashPassword('NoSymbols123456')).rejects.toThrow(/special symbol/);
  });

  it('performs constant-time string comparisons with verifyTimingSafe', () => {
    expect(verifyTimingSafe('identical_string_123', 'identical_string_123')).toBe(true);
    expect(verifyTimingSafe('string_a', 'string_b')).toBe(false);
    expect(verifyTimingSafe('different_length', 'short')).toBe(false);
  });
});
