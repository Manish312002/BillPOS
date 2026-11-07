import crypto from 'crypto';
import { env } from '../config/env.js';

// Standard RFC 6238 Base32 Alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a binary Buffer into an unpadded RFC 4648 Base32 string.
 *
 * @param {Buffer} buffer
 * @returns {string} Base32 encoded string
 */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a binary Buffer.
 * Strips whitespace, dashes, and ignores case.
 *
 * @param {string} base32String
 * @returns {Buffer}
 */
export function base32Decode(base32String) {
  if (!base32String || typeof base32String !== 'string') {
    throw new Error('Base32 input must be a non-empty string');
  }

  const sanitized = base32String.toUpperCase().replace(/[\s\-=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid character "${char}" encountered in Base32 string`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically secure Base32 secret for TOTP.
 * Default 20 bytes (160 bits) provides the standard key length for HMAC-SHA1.
 *
 * @param {number} [byteLength=20]
 * @returns {string} Base32 encoded secret
 */
export function generateTotpSecret(byteLength = 20) {
  const randomBytes = crypto.randomBytes(byteLength);
  return base32Encode(randomBytes);
}

/**
 * Computes an RFC 6238 TOTP code for a given Base32 secret and timestamp.
 *
 * @param {string} secret - Base32 encoded secret
 * @param {number|Date} [timestamp=Date.now()] - Unix timestamp in ms or Date object
 * @param {Object} [options]
 * @param {number} [options.stepSeconds=30] - Time step in seconds (default 30)
 * @param {number} [options.digits=6] - Code length (default 6)
 * @returns {string} Padded numeric TOTP code
 */
export function computeTotpCode(secret, timestamp = Date.now(), options = {}) {
  const stepSeconds = options.stepSeconds || 30;
  const digits = options.digits || 6;

  const timeMs = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const counter = Math.floor(timeMs / 1000 / stepSeconds);

  // Pack counter into 8-byte big-endian integer buffer
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const keyBuffer = base32Decode(secret);

  // HMAC-SHA1 calculation
  const hmac = crypto.createHmac('sha1', keyBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // RFC 4226 Dynamic Truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const modulus = Math.pow(10, digits);
  const otpNumber = binary % modulus;

  return otpNumber.toString().padStart(digits, '0');
}

/**
 * Verifies a 6-digit TOTP code against a Base32 secret within a bounded clock-drift window.
 * Uses constant-time comparison to prevent timing side-channel attacks.
 *
 * @param {string} submittedCode - 6-digit string provided by user
 * @param {string} secret - Base32 encoded TOTP secret
 * @param {Object} [options]
 * @param {number|Date} [options.timestamp=Date.now()] - Current timestamp
 * @param {number} [options.window=1] - Number of time steps before/after to check (default 1 = ±30s)
 * @param {number} [options.stepSeconds=30] - Step size in seconds
 * @returns {boolean} True if code matches within the window, false otherwise
 */
export function verifyTotpCode(submittedCode, secret, options = {}) {
  if (
    !submittedCode ||
    typeof submittedCode !== 'string' ||
    !/^\d{6}$/.test(submittedCode.trim())
  ) {
    return false;
  }
  if (!secret || typeof secret !== 'string') {
    return false;
  }

  const window = options.window !== undefined ? options.window : 1;
  const stepSeconds = options.stepSeconds || 30;
  const baseTimeMs =
    options.timestamp instanceof Date
      ? options.timestamp.getTime()
      : options.timestamp || Date.now();
  const cleanedCode = submittedCode.trim();

  try {
    // Check steps within the drift window [-window, ... +window]
    for (let step = -window; step <= window; step++) {
      const checkTimeMs = baseTimeMs + step * stepSeconds * 1000;
      const expectedCode = computeTotpCode(secret, checkTimeMs, { stepSeconds, digits: 6 });

      const codeBuf = Buffer.from(cleanedCode);
      const expectedBuf = Buffer.from(expectedCode);

      if (codeBuf.length === expectedBuf.length && crypto.timingSafeEqual(codeBuf, expectedBuf)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Generates an RFC 6238 standard `otpauth://totp/...` provisioning URI for QR code generation.
 *
 * @param {Object} params
 * @param {string} params.secret - Base32 encoded secret
 * @param {string} params.accountName - User identifier (phone or email, e.g. "+918380989776")
 * @param {string} [params.issuer="BillingBuddy"] - Application label
 * @returns {string} Standard URI
 */
export function generateTotpUri({ secret, accountName, issuer = 'BillingBuddy' }) {
  if (!secret || !accountName) {
    throw new Error('Both secret and accountName are required to generate TOTP URI');
  }

  const encodedIssuer = encodeURIComponent(issuer.trim());
  const encodedAccount = encodeURIComponent(accountName.trim());
  const cleanSecret = secret.toUpperCase().replace(/[\s\-=]/g, '');

  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${cleanSecret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates a set of cryptographically random single-use recovery codes.
 * Formatted as 4 hyphenated blocks of 8 uppercase hexadecimal characters
 * (e.g. "A1B2C3D4-E5F6A7B8-9C0D1E2F-3A4B5C6D").
 *
 * Each recovery code possesses exactly 128 bits (16 bytes) of cryptographic randomness.
 * Total sample space per code: 2^128 (~3.40 x 10^38 possibilities).
 * Plaintext codes must be presented to the user during enrollment and NEVER stored or logged.
 *
 * @param {number} [count=8] - Number of recovery codes to generate
 * @returns {string[]} Array of plain recovery codes for display to the user
 */
export function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(16).toString('hex').toUpperCase(); // 32 hex chars = 128 bits
    const formatted = `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}`;
    codes.push(formatted);
  }
  return codes;
}

/**
 * Computes SHA-256 hash of a recovery code for database storage.
 *
 * @param {string} code
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function hashRecoveryCode(code) {
  if (!code || typeof code !== 'string') {
    throw new Error('Recovery code must be a non-empty string');
  }
  const normalized = code.toUpperCase().replace(/[\s\-]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Verifies a submitted recovery code against a list of hashed recovery codes in constant time.
 * Returns the matching hash if valid, or null if no match.
 *
 * @param {string} submittedCode - User-submitted recovery code
 * @param {string[]} hashedCodes - Array of stored SHA-256 hashes
 * @returns {string|null} The matching stored hash, or null
 */
export function verifyRecoveryCode(submittedCode, hashedCodes = []) {
  if (!submittedCode || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
    return null;
  }

  const submittedHash = hashRecoveryCode(submittedCode);
  const submittedBuf = Buffer.from(submittedHash, 'hex');

  for (const storedHash of hashedCodes) {
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (
      storedBuf.length === submittedBuf.length &&
      crypto.timingSafeEqual(storedBuf, submittedBuf)
    ) {
      return storedHash;
    }
  }

  return null;
}

/**
 * Validates and extracts a 32-byte encryption key for AES-256-GCM.
 * Rejects missing, weak, or malformed keys without performing key derivation.
 *
 * @param {string|Buffer} [customKey] - Optional custom key (defaults to env.TOTP_ENCRYPTION_KEY)
 * @returns {Buffer} Exactly 32-byte Buffer
 */
export function validateEncryptionKey(customKey) {
  const rawKey = customKey !== undefined ? customKey : env.TOTP_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error('TOTP encryption key is not configured');
  }

  if (Buffer.isBuffer(rawKey)) {
    if (rawKey.length !== 32) {
      throw new Error(
        `Invalid TOTP encryption key: expected 32 bytes, received buffer of ${rawKey.length} bytes`
      );
    }
    return rawKey;
  }

  if (typeof rawKey !== 'string') {
    throw new Error('Invalid TOTP encryption key: must be a 32-byte buffer or string');
  }

  // If 64 hex characters, parse as hex bytes
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  // If raw 32-byte UTF-8 string
  const buf = Buffer.from(rawKey, 'utf8');
  if (buf.length === 32) {
    return buf;
  }

  throw new Error(
    `Invalid TOTP encryption key: must be exactly 32 bytes (or 64 hexadecimal characters), received ${buf.length} bytes`
  );
}

/**
 * Encrypts a plaintext TOTP secret using authenticated AES-256-GCM.
 *
 * Payload format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * - Version: "v1"
 * - IV: 12 cryptographically random bytes (24 hex characters)
 * - Auth Tag: 16 authentication bytes (32 hex characters)
 * - Ciphertext: AES-256-GCM encrypted secret in hex
 *
 * @param {string} secret - Plaintext TOTP Base32 secret
 * @param {string|Buffer} [customKey] - Optional 32-byte encryption key (defaults to env.TOTP_ENCRYPTION_KEY)
 * @returns {string} Serialized versioned encryption payload
 */
export function encryptTotpSecret(secret, customKey) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Secret to encrypt must be a non-empty string');
  }

  const keyBuffer = validateEncryptionKey(customKey);
  const iv = crypto.randomBytes(12); // Fresh 12-byte cryptographically random IV

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypts a versioned AES-256-GCM payload and returns the original plaintext TOTP secret.
 * Rejects tampered ciphertext, modified authentication tags, corrupted payloads, and wrong keys.
 * Never logs keys, plaintext secrets, or decrypted TOTP secrets.
 *
 * @param {string} encryptedPayload - Serialized payload ("v1:<iv>:<tag>:<ciphertext>")
 * @param {string|Buffer} [customKey] - Optional 32-byte encryption key (defaults to env.TOTP_ENCRYPTION_KEY)
 * @returns {string} Plaintext TOTP Base32 secret
 */
export function decryptTotpSecret(encryptedPayload, customKey) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Encrypted payload must be a non-empty string');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encryption payload: invalid part structure');
  }

  const [version, ivHex, tagHex, ciphertextHex] = parts;

  if (version !== 'v1') {
    throw new Error(`Unsupported encryption payload version: ${version}`);
  }

  if (!/^[0-9a-fA-F]{24}$/.test(ivHex)) {
    throw new Error('Malformed encryption payload: invalid 12-byte IV');
  }

  if (!/^[0-9a-fA-F]{32}$/.test(tagHex)) {
    throw new Error('Malformed encryption payload: invalid 16-byte authentication tag');
  }

  if (!/^[0-9a-fA-F]+$/.test(ciphertextHex) || ciphertextHex.length % 2 !== 0) {
    throw new Error('Malformed encryption payload: invalid ciphertext');
  }

  const keyBuffer = validateEncryptionKey(customKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Failed to decrypt TOTP secret: authentication failed or payload corrupted');
  }
}
