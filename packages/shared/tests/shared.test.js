import { describe, it, expect } from 'vitest';
import {
  PLATFORM_ROLES,
  TENANT_ROLES,
  ALL_ROLES,
  HTTP_STATUS,
  ERROR_CODES,
  paginationQuerySchema,
  paginationMetaSchema,
  healthResponseSchema,
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  slugify,
  truncate,
  capitalize,
  toISOStringSafe,
  formatDateStandard,
} from '../src/index.js';

describe('@billingbuddy/shared Constants', () => {
  it('exports frozen platform and tenant roles', () => {
    expect(PLATFORM_ROLES.SUPERADMIN).toBe('SUPERADMIN');
    expect(TENANT_ROLES.OWNER).toBe('STORE_OWNER');
    expect(TENANT_ROLES.CASHIER).toBe('CASHIER');
    expect(ALL_ROLES).toContain('SUPERADMIN');
    expect(ALL_ROLES).toContain('STORE_OWNER');
    expect(Object.isFrozen(PLATFORM_ROLES)).toBe(true);
    expect(Object.isFrozen(TENANT_ROLES)).toBe(true);
  });

  it('exports HTTP status codes', () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
  });

  it('exports standard application error codes', () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
  });
});

describe('@billingbuddy/shared Validation Contracts', () => {
  it('validates and applies defaults for pagination queries', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.sortOrder).toBe('desc');
  });

  it('validates pagination meta schema', () => {
    const meta = {
      totalItems: 100,
      currentPage: 1,
      totalPages: 5,
      pageSize: 20,
      hasNextPage: true,
      hasPrevPage: false,
    };
    const parsed = paginationMetaSchema.parse(meta);
    expect(parsed.totalItems).toBe(100);
  });

  it('validates health response structure', () => {
    const health = {
      status: 'ok',
      service: 'billingbuddy-api',
      version: '0.1.0',
      environment: 'development',
      uptimeSeconds: 120,
      timestamp: new Date().toISOString(),
    };
    const parsed = healthResponseSchema.parse(health);
    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('billingbuddy-api');
  });
});

describe('@billingbuddy/shared Utilities', () => {
  it('converts rupees to paise accurately without floating point drift', () => {
    expect(rupeesToPaise(100)).toBe(10000);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise('250.50')).toBe(25050);
  });

  it('converts paise to rupees float', () => {
    expect(paiseToRupees(10000)).toBe(100);
    expect(paiseToRupees(1999)).toBe(19.99);
  });

  it('formats currency as Indian Rupee (INR)', () => {
    const formatted = formatINR(125050); // 1,250.50
    expect(formatted).toContain('1,250.50');
  });

  it('slugifies string inputs', () => {
    expect(slugify('Store #101 Main Counter!')).toBe('store-101-main-counter');
  });

  it('truncates strings cleanly', () => {
    expect(truncate('Short string', 20)).toBe('Short string');
    expect(truncate('This is a longer string that exceeds twenty chars', 20)).toBe(
      'This is a longer str...'
    );
  });

  it('capitalizes strings', () => {
    expect(capitalize('retail store billing')).toBe('Retail Store Billing');
  });

  it('formats date and ISO strings safely', () => {
    const d = new Date('2026-11-07T12:00:00Z');
    expect(toISOStringSafe(d)).toBe('2026-11-07T12:00:00.000Z');
    expect(toISOStringSafe('invalid-date')).toBe('');
    expect(formatDateStandard(d)).toContain('2026');
  });
});
