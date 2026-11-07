/**
 * Abstract WhatsAppProvider base interface.
 * Production integrations (e.g. Meta Cloud API, Gupshup, Twilio) must extend this class.
 */
export class WhatsAppProvider {
  /**
   * @param {string} providerName
   */
  constructor(providerName = 'abstract') {
    this.providerName = providerName;
  }

  /**
   * Dispatches an OTP verification message.
   *
   * @param {Object} params
   * @param {string} params.destination - E.164 phone number
   * @param {string} params.otp - 6-digit OTP code (must not be logged)
   * @param {string} params.purpose - Purpose (SUPERADMIN_LOGIN, OWNER_ACTIVATION)
   * @param {number} [params.expiryMinutes=5] - Validity window
   * @returns {Promise<{ success: boolean, messageId: string, timestamp: Date }>}
   */
  async sendOtpMessage() {
    throw new Error('sendOtpMessage() must be implemented by concrete WhatsAppProvider');
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
  async sendInvitationMessage() {
    throw new Error('sendInvitationMessage() must be implemented by concrete WhatsAppProvider');
  }
}

export default WhatsAppProvider;
