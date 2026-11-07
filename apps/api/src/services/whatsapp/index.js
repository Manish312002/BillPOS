import { env } from '../../config/env.js';
import { WhatsAppProvider } from './WhatsAppProvider.js';
import { MockWhatsAppProvider } from './MockWhatsAppProvider.js';

let activeProviderInstance = null;

/**
 * Factory function to resolve the active WhatsApp provider based on configuration.
 *
 * @param {Object} [config]
 * @param {string} [config.provider=env.WHATSAPP_PROVIDER]
 * @param {string} [config.apiKey=env.WHATSAPP_API_KEY]
 * @param {string} [config.phoneNumberId=env.WHATSAPP_PHONE_NUMBER_ID]
 * @returns {WhatsAppProvider}
 */
export function getWhatsAppProvider(config = {}) {
  const providerType = config.provider || env.WHATSAPP_PROVIDER || 'mock';
  const apiKey = config.apiKey !== undefined ? config.apiKey : env.WHATSAPP_API_KEY;

  if (providerType === 'mock') {
    if (!activeProviderInstance || !(activeProviderInstance instanceof MockWhatsAppProvider)) {
      activeProviderInstance = new MockWhatsAppProvider();
    }
    return activeProviderInstance;
  }

  // Real external provider integration boundaries (Meta Cloud API, Gupshup, Twilio)
  if (['meta', 'gupshup', 'twilio'].includes(providerType)) {
    if (!apiKey) {
      throw new Error(
        `[WhatsApp Configuration Error] WhatsApp provider "${providerType}" is configured, but required credentials (WHATSAPP_API_KEY) are missing. Cannot simulate delivery without valid provider configuration.`
      );
    }
    throw new Error(
      `[WhatsApp Configuration Error] Provider adapter for "${providerType}" is not yet connected. Configure WHATSAPP_PROVIDER=mock for development and testing.`
    );
  }

  throw new Error(
    `[WhatsApp Configuration Error] Unknown WhatsApp provider type: "${providerType}".`
  );
}

export const whatsAppProvider = getWhatsAppProvider();

export { WhatsAppProvider, MockWhatsAppProvider };
export default whatsAppProvider;
