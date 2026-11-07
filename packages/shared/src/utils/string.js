/**
 * Reusable String Manipulation Utilities
 */

/**
 * Converts a string to a URL-safe slug
 * @param {string} text
 * @returns {string} URL slug
 */
export function slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Truncates string with ellipsis if longer than maxLength
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(str, maxLength = 50) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength).trim()}...`;
}

/**
 * Capitalizes first letter of each word
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
}
