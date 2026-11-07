/**
 * Retail Currency & Paise Calculations
 * Prevents IEEE 754 floating point precision errors by working in integer paise.
 */

/**
 * Converts Indian Rupees (float/number) to integer paise
 * @param {number|string} rupees
 * @returns {number} Integer paise
 */
export function rupeesToPaise(rupees) {
  const val = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

/**
 * Converts integer paise to Indian Rupees float
 * @param {number} paise
 * @returns {number} Rupees
 */
export function paiseToRupees(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) return 0;
  return Number((paise / 100).toFixed(2));
}

/**
 * Formats integer paise as INR string (e.g. "₹1,249.50")
 * @param {number} paise
 * @param {object} options
 * @returns {string} Formatted INR string
 */
export function formatINR(paise, options = {}) {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(rupees);
}
