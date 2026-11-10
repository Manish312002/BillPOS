import { toBigIntPaise, formatINR } from '../utils/currency.js';
import { FEATURE_VALUE_TYPE } from '../contracts/subscription.contracts.js';

/**
 * Helper to safely convert Date or ISO string to ISO string
 * @param {Date|string|null|undefined} date
 * @returns {string|null}
 */
const toIsoStringOrNull = (date) => {
  if (!date) return null;
  if (typeof date === 'string') return date;
  if (date instanceof Date && !isNaN(date.getTime())) {
    return date.toISOString();
  }
  return null;
};

/**
 * Format an arbitrary paise value (BigInt, string, number) into canonical DTO representation
 *
 * @param {bigint|string|number|null|undefined} amountPaise
 * @param {object} [options]
 * @param {boolean} [options.allowNull=false] If true and value is null/undefined, returns null
 * @returns {{ amountPaise: string, amountFormatted: string } | null}
 */
export function formatPaiseDto(amountPaise, options = {}) {
  const { allowNull = false } = options;
  if (amountPaise === null || amountPaise === undefined) {
    if (allowNull) return null;
    return {
      amountPaise: '0',
      amountFormatted: formatINR(0n),
    };
  }

  const bigIntPaise = toBigIntPaise(amountPaise);
  return {
    amountPaise: bigIntPaise.toString(),
    amountFormatted: formatINR(bigIntPaise),
  };
}

/**
 * Resolve feature value according to its type enum
 *
 * @param {object} feature
 * @returns {number|boolean|string|object|null}
 */
export function resolvePlanFeatureValue(feature) {
  if (!feature) return null;
  switch (feature.valueType) {
    case FEATURE_VALUE_TYPE.NUMERIC:
      return feature.valueNumeric !== null && feature.valueNumeric !== undefined
        ? Number(feature.valueNumeric)
        : null;
    case FEATURE_VALUE_TYPE.BOOLEAN:
      return Boolean(feature.valueBoolean);
    case FEATURE_VALUE_TYPE.STRING:
      return feature.valueString ?? null;
    case FEATURE_VALUE_TYPE.JSON:
      if (!feature.valueJson) return null;
      if (typeof feature.valueJson === 'string') {
        try {
          return JSON.parse(feature.valueJson);
        } catch {
          return feature.valueJson;
        }
      }
      return feature.valueJson;
    default:
      return (
        feature.valueNumeric ??
        feature.valueBoolean ??
        feature.valueString ??
        feature.valueJson ??
        null
      );
  }
}

/**
 * Transform Prisma PlanPrice model into explicit DTO
 * Guarantees zero BigInt fields in output
 *
 * @param {object} price
 * @returns {object|null}
 */
export function toPlanPriceDto(price) {
  if (!price) return null;

  const bigIntAmount = toBigIntPaise(price.amountPaise);

  return {
    id: price.id,
    planId: price.planId,
    billingCycle: price.billingCycle,
    currency: price.currency ?? 'INR',
    amountPaise: bigIntAmount.toString(),
    amountFormatted: formatINR(bigIntAmount),
    isActive: Boolean(price.isActive),
    createdAt: toIsoStringOrNull(price.createdAt),
    updatedAt: toIsoStringOrNull(price.updatedAt),
  };
}

/**
 * Transform Prisma PlanFeature model into explicit DTO
 *
 * @param {object} feature
 * @returns {object|null}
 */
export function toPlanFeatureDto(feature) {
  if (!feature) return null;

  return {
    id: feature.id,
    planId: feature.planId,
    featureKey: feature.featureKey,
    valueType: feature.valueType,
    resolvedValue: resolvePlanFeatureValue(feature),
    valueNumeric: feature.valueNumeric !== null && feature.valueNumeric !== undefined ? Number(feature.valueNumeric) : null,
    valueBoolean: feature.valueBoolean !== null && feature.valueBoolean !== undefined ? Boolean(feature.valueBoolean) : null,
    valueString: feature.valueString ?? null,
    valueJson: feature.valueJson ?? null,
    createdAt: toIsoStringOrNull(feature.createdAt),
    updatedAt: toIsoStringOrNull(feature.updatedAt),
  };
}

/**
 * Transform Prisma SubscriptionPlan model (with prices and features) into explicit DTO
 * Guarantees zero BigInt fields and clean dictionary lookup for features
 *
 * @param {object} plan
 * @returns {object|null}
 */
export function toPlanDto(plan) {
  if (!plan) return null;

  const prices = Array.isArray(plan.prices) ? plan.prices.map(toPlanPriceDto) : [];
  const rawFeatures = Array.isArray(plan.features) ? plan.features.map(toPlanFeatureDto) : [];

  const featuresMap = {};
  if (Array.isArray(plan.features)) {
    for (const feat of plan.features) {
      if (feat && feat.featureKey) {
        featuresMap[feat.featureKey] = resolvePlanFeatureValue(feat);
      }
    }
  }

  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? null,
    trialDays: Number(plan.trialDays ?? 0),
    isActive: Boolean(plan.isActive),
    isPublic: Boolean(plan.isPublic),
    version: Number(plan.version ?? 1),
    prices,
    features: featuresMap,
    rawFeatures,
    createdAt: toIsoStringOrNull(plan.createdAt),
    updatedAt: toIsoStringOrNull(plan.updatedAt),
  };
}

/**
 * Transform Prisma TenantEntitlementOverride model into explicit DTO
 *
 * @param {object} override
 * @returns {object|null}
 */
export function toTenantEntitlementOverrideDto(override) {
  if (!override) return null;

  return {
    id: override.id,
    tenantId: override.tenantId,
    subscriptionId: override.subscriptionId ?? null,
    featureKey: override.featureKey,
    valueType: override.valueType,
    resolvedValue: resolvePlanFeatureValue(override),
    valueNumeric: override.valueNumeric !== null && override.valueNumeric !== undefined ? Number(override.valueNumeric) : null,
    valueBoolean: override.valueBoolean !== null && override.valueBoolean !== undefined ? Boolean(override.valueBoolean) : null,
    valueString: override.valueString ?? null,
    valueJson: override.valueJson ?? null,
    reason: override.reason,
    createdBy: override.createdBy,
    expiresAt: toIsoStringOrNull(override.expiresAt),
    createdAt: toIsoStringOrNull(override.createdAt),
    updatedAt: toIsoStringOrNull(override.updatedAt),
  };
}

/**
 * Transform Prisma SubscriptionPayment model into explicit DTO
 * Serializes BigInt amountPaise to decimal integer string and localized INR representation
 *
 * @param {object} payment
 * @returns {object|null}
 */
export function toSubscriptionPaymentDto(payment) {
  if (!payment) return null;

  const bigIntAmount = toBigIntPaise(payment.amountPaise);

  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    amountPaise: bigIntAmount.toString(),
    amountFormatted: formatINR(bigIntAmount),
    referenceNumber: payment.referenceNumber,
    method: payment.method,
    status: payment.status,
    rejectionReason: payment.rejectionReason ?? null,
    verifiedAt: toIsoStringOrNull(payment.verifiedAt),
    bankTransactionDate: toIsoStringOrNull(payment.bankTransactionDate),
    proofDocumentUrl: payment.proofDocumentUrl ?? null,
    notes: payment.notes ?? null,
    createdAt: toIsoStringOrNull(payment.createdAt),
    updatedAt: toIsoStringOrNull(payment.updatedAt),
  };
}

/**
 * Transform Prisma SubscriptionInvoice model into explicit DTO
 * Serializes subtotalPaise, taxPaise, and totalPaise to decimal integer strings
 *
 * @param {object} invoice
 * @returns {object|null}
 */
export function toSubscriptionInvoiceDto(invoice) {
  if (!invoice) return null;

  const subtotalBigInt = toBigIntPaise(invoice.subtotalPaise);
  const taxBigInt = toBigIntPaise(invoice.taxPaise);
  const totalBigInt = toBigIntPaise(invoice.totalPaise);

  const payments = Array.isArray(invoice.payments)
    ? invoice.payments.map(toSubscriptionPaymentDto)
    : [];

  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    subscriptionId: invoice.subscriptionId ?? null,
    invoiceNumber: invoice.invoiceNumber,
    billingCycle: invoice.billingCycle,
    subtotalPaise: subtotalBigInt.toString(),
    subtotalFormatted: formatINR(subtotalBigInt),
    taxRate: Number(invoice.taxRate ?? 0),
    taxPaise: taxBigInt.toString(),
    taxFormatted: formatINR(taxBigInt),
    totalPaise: totalBigInt.toString(),
    totalFormatted: formatINR(totalBigInt),
    amountPaise: totalBigInt.toString(),
    amountFormatted: formatINR(totalBigInt),
    currency: invoice.currency ?? 'INR',
    status: invoice.status,
    dueDate: toIsoStringOrNull(invoice.dueDate),
    paidAt: toIsoStringOrNull(invoice.paidAt),
    metadata: invoice.metadata ?? null,
    payments,
    createdAt: toIsoStringOrNull(invoice.createdAt),
    updatedAt: toIsoStringOrNull(invoice.updatedAt),
  };
}

/**
 * Transform Prisma TenantSubscription model into explicit DTO
 * Serializes subscription lifecycle status, timestamps, and nested plan/invoices
 *
 * @param {object} subscription
 * @returns {object|null}
 */
export function toTenantSubscriptionDto(subscription) {
  if (!subscription) return null;

  const planDto = subscription.plan ? toPlanDto(subscription.plan) : null;
  const invoicesDto = Array.isArray(subscription.invoices)
    ? subscription.invoices.map(toSubscriptionInvoiceDto)
    : [];
  const overridesDto = Array.isArray(subscription.overrides)
    ? subscription.overrides.map(toTenantEntitlementOverrideDto)
    : [];

  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    planId: subscription.planId,
    status: subscription.status,
    billingCycle: subscription.billingCycle,
    currentPeriodStart: toIsoStringOrNull(subscription.currentPeriodStart),
    currentPeriodEnd: toIsoStringOrNull(subscription.currentPeriodEnd),
    trialStartedAt: toIsoStringOrNull(subscription.trialStartedAt),
    trialEndsAt: toIsoStringOrNull(subscription.trialEndsAt),
    gracePeriodEndsAt: toIsoStringOrNull(subscription.gracePeriodEndsAt),
    readOnlyStartsAt: toIsoStringOrNull(subscription.readOnlyStartsAt),
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    canceledAt: toIsoStringOrNull(subscription.canceledAt),
    version: Number(subscription.version ?? 1),
    plan: planDto,
    invoices: invoicesDto,
    overrides: overridesDto,
    createdAt: toIsoStringOrNull(subscription.createdAt),
    updatedAt: toIsoStringOrNull(subscription.updatedAt),
  };
}
