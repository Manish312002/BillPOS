/**
 * Retail Currency, Paise Calculations & BigInt Monetary Arithmetic
 * Prevents IEEE 754 floating-point precision errors by working strictly in integer paise.
 *
 * Mandatory Financial Representation Invariants:
 * - Internal monetary calculations: Native JavaScript BigInt
 * - API wire representation: Canonical decimal integer strings
 * - UI presentation: Localized INR currency formatting (₹)
 * - Zero floating-point arithmetic permitted for monetary calculations.
 * - Zero global BigInt prototype modifications.
 *
 * Domain Boundary Isolation:
 * - SECTION A: PURE BIGINT SUBSCRIPTION & FINANCIAL ENGINE (Authoritative for WP-SUB)
 * - SECTION B: LEGACY FLOAT CONVERTERS (Restricted to legacy checkout flows; forbidden in WP-SUB)
 */

/* ========================================================================== */
/* SECTION A: PURE BIGINT SUBSCRIPTION & FINANCIAL ENGINE                     */
/* ========================================================================== */

/**
 * Safely converts an amount to a native JavaScript BigInt representing paise.
 * Accepts BigInt directly, canonical decimal integer strings, or JavaScript Number if Number.isSafeInteger(value).
 * Rejects unsafe integers, floats, NaN, Infinity, and invalid inputs.
 *
 * @param {bigint|string|number} value
 * @param {object} [options]
 * @param {boolean} [options.allowNegative=false]
 * @returns {bigint} Native BigInt paise
 * @throws {TypeError|RangeError} On float, unsafe integer, or invalid format
 */
export function toBigIntPaise(value, options = {}) {
  const { allowNegative = false } = options;

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'string') {
    const isCanonical = allowNegative
      ? /^(?:0|-?[1-9]\d*)$/.test(value)
      : /^(?:0|[1-9]\d*)$/.test(value);
    if (!isCanonical) {
      throw new TypeError(
        `Cannot convert "${value}" to BigInt paise: expected canonical decimal integer string without decimals, signs, whitespace, or leading zeros`
      );
    }
    return BigInt(value);
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `Cannot convert non-safe integer or float (${value}) to BigInt paise without precision loss: Number.isSafeInteger check failed`
      );
    }
    if (!allowNegative && value < 0) {
      throw new RangeError(`Expected non-negative integer paise, got negative: ${value}`);
    }
    return BigInt(value);
  }

  throw new TypeError(
    `Expected bigint, canonical decimal integer string, or safe integer number, got: ${typeof value}`
  );
}

/**
 * Pure BigInt addition of multiple paise amounts.
 * Prevents precision loss across arbitrary financial sums.
 *
 * @param {...(bigint|string|number)} amounts
 * @returns {bigint} Sum in BigInt paise
 */
export function addPaise(...amounts) {
  let total = 0n;
  for (const amt of amounts) {
    if (amt !== null && amt !== undefined) {
      total += toBigIntPaise(amt);
    }
  }
  return total;
}

/**
 * Pure BigInt subtraction of subtrahend from minuend.
 *
 * @param {bigint|string|number} minuend
 * @param {bigint|string|number} subtrahend
 * @param {object} [options]
 * @param {boolean} [options.allowNegative=false]
 * @returns {bigint} Resulting BigInt paise
 */
export function subtractPaise(minuend, subtrahend, options = {}) {
  const { allowNegative = false } = options;
  const result = toBigIntPaise(minuend) - toBigIntPaise(subtrahend);
  if (!allowNegative && result < 0n) {
    throw new RangeError('Subtraction result cannot be negative');
  }
  return result;
}

/**
 * Multiplies an integer paise amount by an integer factor using pure BigInt arithmetic.
 *
 * @param {bigint|string|number} paise
 * @param {bigint|string|number} factor
 * @returns {bigint} Product in BigInt paise
 */
export function multiplyPaise(paise, factor) {
  return toBigIntPaise(paise) * toBigIntPaise(factor);
}

/**
 * Calculates tax in integer paise using round-half-up integer arithmetic without floating-point math.
 * Formula: floor((subtotalPaise * taxRatePercent + 50n) / 100n)
 *
 * Example: 99900n paise (₹999.00) @ 18% GST -> 17982n paise (₹179.82)
 *
 * @param {bigint|string|number} subtotalPaise
 * @param {bigint|string|number} taxRatePercent (e.g. 18 for 18%)
 * @returns {bigint} Tax in BigInt paise
 */
export function calculateTaxPaise(subtotalPaise, taxRatePercent) {
  const subtotal = toBigIntPaise(subtotalPaise);
  const rate = toBigIntPaise(taxRatePercent);
  if (subtotal < 0n || rate < 0n) {
    throw new RangeError('Tax calculation amounts must be non-negative');
  }
  // Round-half-up integer arithmetic: (subtotal * rate + 50n) / 100n
  return (subtotal * rate + 50n) / 100n;
}

/**
 * Calculates itemized subtotal, tax, and total in integer paise.
 *
 * @param {bigint|string|number} subtotalPaise
 * @param {bigint|string|number} taxRatePercent (default: 18)
 * @returns {{ subtotalPaise: bigint, taxRatePercent: bigint, taxPaise: bigint, totalPaise: bigint }}
 */
export function calculateInvoiceBreakdown(subtotalPaise, taxRatePercent = 18n) {
  const subtotal = toBigIntPaise(subtotalPaise);
  const rate = toBigIntPaise(taxRatePercent);
  const tax = calculateTaxPaise(subtotal, rate);
  return {
    subtotalPaise: subtotal,
    taxRatePercent: rate,
    taxPaise: tax,
    totalPaise: subtotal + tax
  };
}

/**
 * Formats integer paise as a localized INR string (e.g., "₹999.00", "₹1,249.50", "₹10,00,000.00").
 * Preserves exact digits and avoids floating-point precision loss by using pure BigInt string splitting.
 * Supports BigInt, decimal integer string, or safe integer number.
 *
 * @param {bigint|string|number} paise
 * @param {object} [options]
 * @param {boolean} [options.currencySymbol=true] Whether to include the ₹ prefix
 * @param {boolean} [options.allowNegative=false] Whether negative values are formatted with a minus sign
 * @returns {string} Formatted localized currency string
 */
export function formatINR(paise, options = {}) {
  if (paise === null || paise === undefined) return '';

  let bigintPaise;
  try {
    bigintPaise = toBigIntPaise(paise);
  } catch {
    return '';
  }

  const { currencySymbol = true, allowNegative = false, ...intlOptions } = options;

  const isNegative = bigintPaise < 0n;
  if (isNegative && !allowNegative) {
    throw new RangeError('Cannot format negative paise value unless allowNegative is true');
  }

  const absPaise = isNegative ? -bigintPaise : bigintPaise;

  const rupeesPart = absPaise / 100n;
  const paisePart = absPaise % 100n;

  // Intl.NumberFormat natively supports BigInt formatting in Indian grouping (lakhs & crores)
  const formattedRupees = new Intl.NumberFormat('en-IN', {
    useGrouping: true,
    ...intlOptions
  }).format(rupeesPart);

  const formattedPaise = paisePart.toString().padStart(2, '0');
  const sign = isNegative ? '-' : '';
  const symbol = currencySymbol ? '₹' : '';

  return `${sign}${symbol}${formattedRupees}.${formattedPaise}`;
}

/* ========================================================================== */
/* SECTION B: LEGACY FLOAT CONVERTERS (FORBIDDEN IN WP-SUB)                   */
/*                                                                            */
/* These legacy floating-point conversion helpers are retained strictly for  */
/* backwards compatibility with pre-existing legacy checkout flows.           */
/* They MUST NOT be imported or used in the Subscription & Entitlements       */
/* domain (WP-SUB), where all monetary arithmetic is strictly native BigInt.  */
/* ========================================================================== */

/**
 * Converts Indian Rupees (float/number/string) to integer paise.
 * @deprecated FOR LEGACY RETAIL CHECKOUT ONLY. DO NOT USE IN WP-SUB.
 *
 * @param {number|string} rupees
 * @returns {number} Integer paise (as Number within safe integer range)
 */
export function rupeesToPaise(rupees) {
  const val = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return 0;
  return Math.round(val * 100);
}

/**
 * Converts integer paise to Indian Rupees float.
 * @deprecated FOR LEGACY RETAIL CHECKOUT ONLY. DO NOT USE IN WP-SUB.
 *
 * @param {number|bigint|string} paise
 * @returns {number} Rupees as float
 */
export function paiseToRupees(paise) {
  if (paise === null || paise === undefined) return 0;
  if (typeof paise === 'bigint') {
    return Number(paise) / 100;
  }
  const numeric = typeof paise === 'string' ? Number(paise) : paise;
  if (typeof numeric !== 'number' || isNaN(numeric)) return 0;
  return Number((numeric / 100).toFixed(2));
}
