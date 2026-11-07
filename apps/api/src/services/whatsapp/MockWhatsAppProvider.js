import crypto from 'crypto';
import { WhatsAppProvider } from './WhatsAppProvider.js';

/**
 * Mock WhatsApp Provider for local development, testing, and staging environments.
 * Stores dispatched messages in an in-memory queue for test assertions without leaking secrets to logs.
 */
export class MockWhatsAppProvider extends WhatsAppProvider {
  constructor() {
    super('mock');
    this.sentMessages = [];
    this.failureToSimulate = null;
  }

  /**
   * Dispatches an OTP verification message.
   *
   * @param {Object} params
   * @param {string} params.destination - E.164 phone number
   * @param {string} params.otp - 6-digit OTP code (redacted in logs)
   * @param {string} params.purpose - Purpose (SUPERADMIN_LOGIN, OWNER_ACTIVATION)
   * @param {number} [params.expiryMinutes=5] - Validity window
   * @returns {Promise<{ success: boolean, messageId: string, timestamp: Date }>}
   */
  async sendOtpMessage({ destination, otp, purpose, expiryMinutes = 5 }) {
    if (this.failureToSimulate) {
      const error = this.failureToSimulate;
      this.failureToSimulate = null;
      throw new Error(`[MockWhatsApp Error] Simulated delivery failure: ${error.message || error}`);
    }

    if (!destination || typeof destination !== 'string') {
      throw new Error('Destination phone number is required');
    }
    if (!otp || typeof otp !== 'string') {
      throw new Error('OTP is required');
    }

    const messageId = `mock_wa_${crypto.randomUUID()}`;
    const timestamp = new Date();

    const record = {
      messageId,
      destination,
      purpose,
      type: 'OTP',
      expiryMinutes,
      timestamp,
      // Stored only for test assertion verification; never exposed to logs
      _otpForTesting: otp,
    };

    this.sentMessages.push(record);

    // Safe logging with OTP value strictly redacted
    console.log(
      `[MockWhatsApp] Dispatched OTP to ${destination} (Purpose: ${purpose}, MessageId: ${messageId})`
    );

    return {
      success: true,
      messageId,
      timestamp,
    };
  }

  /**
   * Dispatches an invitation message to a new Store Owner.
   *
   * @param {Object} params
   * @param {string} params.destination - E.164 phone number
   * @param {string} params.storeName - Name of the store/tenant
   * @param {string} params.invitationLink - Full activation link URL
   * @param {string} params.otp - Initial activation OTP
   * @param {number} [params.expiryHours=12] - Expiration window
   * @returns {Promise<{ success: boolean, messageId: string, timestamp: Date }>}
   */
  async sendInvitationMessage({ destination, storeName, invitationLink, otp, expiryHours = 12 }) {
    if (this.failureToSimulate) {
      const error = this.failureToSimulate;
      this.failureToSimulate = null;
      throw new Error(`[MockWhatsApp Error] Simulated delivery failure: ${error.message || error}`);
    }

    if (!destination || typeof destination !== 'string') {
      throw new Error('Destination phone number is required');
    }
    if (!invitationLink || typeof invitationLink !== 'string') {
      throw new Error('Invitation link is required');
    }

    const messageId = `mock_inv_${crypto.randomUUID()}`;
    const timestamp = new Date();

    const record = {
      messageId,
      destination,
      storeName,
      invitationLink,
      type: 'INVITATION',
      expiryHours,
      timestamp,
      _otpForTesting: otp,
    };

    this.sentMessages.push(record);

    console.log(
      `[MockWhatsApp] Dispatched Owner invitation to ${destination} for Store "${storeName}" (MessageId: ${messageId})`
    );

    return {
      success: true,
      messageId,
      timestamp,
    };
  }

  /**
   * Returns all sent messages in memory.
   */
  getSentMessages() {
    return [...this.sentMessages];
  }

  /**
   * Returns the most recent message dispatched to a specific destination.
   */
  getLastMessageFor(destination) {
    for (let i = this.sentMessages.length - 1; i >= 0; i--) {
      if (this.sentMessages[i].destination === destination) {
        return this.sentMessages[i];
      }
    }
    return null;
  }

  /**
   * Clears the in-memory message history.
   */
  clearMessages() {
    this.sentMessages = [];
  }

  /**
   * Configures the next invocation to throw an error, simulating provider outage or network fault.
   *
   * @param {string|Error} error
   */
  simulateFailureNext(error) {
    this.failureToSimulate = typeof error === 'string' ? new Error(error) : error;
  }
}

export default MockWhatsAppProvider;
