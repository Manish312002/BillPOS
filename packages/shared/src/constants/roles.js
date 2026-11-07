/**
 * BillingBuddy Role Identifiers & Constants
 * Used for platform-level and tenant-level access categorization
 */

export const PLATFORM_ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  OPERATOR: 'PLATFORM_OPERATOR',
});

export const TENANT_ROLES = Object.freeze({
  OWNER: 'STORE_OWNER',
  MANAGER: 'STORE_MANAGER',
  CASHIER: 'CASHIER',
});

export const ALL_ROLES = Object.freeze([
  PLATFORM_ROLES.SUPERADMIN,
  PLATFORM_ROLES.OPERATOR,
  TENANT_ROLES.OWNER,
  TENANT_ROLES.MANAGER,
  TENANT_ROLES.CASHIER,
]);
