/**
 * BillingBuddy — Manual WhatsApp Click-to-Chat Utility (ADR-002)
 *
 * Implements official wa.me deep-linking for manual sharing of owner invitations.
 * Strict ₹0 messaging cost policy: zero paid APIs, zero automated messaging providers.
 */

/**
 * Normalizes a phone number into international digits-only format required by wa.me.
 * Strips '+', spaces, hyphens, and parentheses.
 *
 * @param {string} rawPhone - Raw phone string (e.g. "+91 83809-89776")
 * @returns {string} Digits-only string (e.g. "918380989776")
 */
export function normalizeWhatsAppPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new Error('Phone number must be a non-empty string');
  }

  // Strip all non-digit characters
  const digitsOnly = rawPhone.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    // 10-digit Indian mobile number without country code -> default to country code 91
    return `91${digitsOnly}`;
  }

  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    throw new Error(
      `Invalid phone number length for WhatsApp Click-to-Chat. Expected 10-15 digits, got ${digitsOnly.length} ("${digitsOnly}")`
    );
  }

  return digitsOnly;
}

/**
 * Generates the standardized invitation message template for Store Owners.
 *
 * @param {Object} params
 * @param {string} params.ownerName - Name of the invited Store Owner
 * @param {string} params.storeName - Name of the store or retail tenant
 * @param {string} params.invitationLink - Full HTTPS activation URL
 * @param {number} [params.expiryHours=12] - Expiration duration in hours
 * @returns {string} Plain text message ready for URL encoding
 */
export function generateInvitationMessage({
  ownerName,
  storeName,
  invitationLink,
  expiryHours = 12,
}) {
  if (!ownerName || typeof ownerName !== 'string') {
    throw new Error('ownerName is required to generate invitation message');
  }
  if (!storeName || typeof storeName !== 'string') {
    throw new Error('storeName is required to generate invitation message');
  }
  if (!invitationLink || typeof invitationLink !== 'string') {
    throw new Error('invitationLink is required to generate invitation message');
  }

  return (
    `Hello ${ownerName.trim()},\n\n` +
    `You have been invited to set up your store "${storeName.trim()}" on BillingBuddy.\n\n` +
    `Click this secure activation link to set your password and access your store dashboard:\n` +
    `${invitationLink.trim()}\n\n` +
    `(Note: This secure link expires in ${expiryHours} hours.)`
  );
}

/**
 * Generates an official WhatsApp Click-to-Chat URL (wa.me).
 *
 * @param {Object} params
 * @param {string} params.phone - Destination phone number
 * @param {string} params.message - Message body
 * @returns {string} Full wa.me Click-to-Chat link
 */
export function generateWhatsAppLink({ phone, message }) {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Message text is required to generate WhatsApp link');
  }

  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const encodedText = encodeURIComponent(message.trim());

  return `https://wa.me/${normalizedPhone}?text=${encodedText}`;
}
