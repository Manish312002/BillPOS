/**
 * Date & Timestamp Utilities
 */

/**
 * Safely parses any date/timestamp to standard ISO 8601 string
 * @param {Date|string|number} date
 * @returns {string} ISO string or empty string on invalid date
 */
export function toISOStringSafe(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch {
    return '';
  }
}

/**
 * Formats a date into Indian standard retail format: DD/MM/YYYY
 * @param {Date|string|number} date
 * @returns {string} Formatted date string
 */
export function formatDateStandard(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}
