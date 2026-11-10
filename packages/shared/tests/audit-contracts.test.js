import { describe, it, expect } from 'vitest';
import {
  AUDIT_STATUS,
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  AUDIT_ACTIONS,
  auditStatusSchema,
  auditModuleSchema,
  auditDiffSchema,
  recordAuditEventSchema,
} from '../src/contracts/audit.contracts.js';

describe('Shared Audit Contracts & Validation Schemas (Module 3.1)', () => {
  describe('AUDIT_STATUS & auditStatusSchema', () => {
    it('accepts valid audit status values', () => {
      expect(auditStatusSchema.parse(AUDIT_STATUS.SUCCESS)).toBe('SUCCESS');
      expect(auditStatusSchema.parse(AUDIT_STATUS.FAILURE)).toBe('FAILURE');
      expect(auditStatusSchema.parse(AUDIT_STATUS.DENIED)).toBe('DENIED');
    });

    it('rejects invalid audit status values', () => {
      expect(() => auditStatusSchema.parse('PENDING')).toThrow();
      expect(() => auditStatusSchema.parse('UNKNOWN')).toThrow();
    });
  });

  describe('AUDIT_MODULES & auditModuleSchema', () => {
    it('accepts valid audit module identifiers', () => {
      expect(auditModuleSchema.parse(AUDIT_MODULES.AUTH)).toBe('AUTH');
      expect(auditModuleSchema.parse(AUDIT_MODULES.TENANT)).toBe('TENANT');
      expect(auditModuleSchema.parse(AUDIT_MODULES.BILLING)).toBe('BILLING');
      expect(auditModuleSchema.parse(AUDIT_MODULES.POS)).toBe('POS');
      expect(auditModuleSchema.parse(AUDIT_MODULES.SETTINGS)).toBe('SETTINGS');
      expect(auditModuleSchema.parse(AUDIT_MODULES.SYSTEM)).toBe('SYSTEM');
    });

    it('rejects invalid module names', () => {
      expect(() => auditModuleSchema.parse('INVALID_MODULE')).toThrow();
    });
  });

  describe('AUDIT_ACTIONS', () => {
    it('defines canonical authentication audit actions', () => {
      expect(AUDIT_ACTIONS.SUPERADMIN_LOGIN_SUCCESS).toBe('SUPERADMIN_LOGIN_SUCCESS');
      expect(AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED).toBe('SUPERADMIN_LOGIN_FAILED');
      expect(AUDIT_ACTIONS.SUPERADMIN_LOGOUT).toBe('SUPERADMIN_LOGOUT');
      expect(AUDIT_ACTIONS.SUPERADMIN_SESSION_REVOKED).toBe('SUPERADMIN_SESSION_REVOKED');
      expect(AUDIT_ACTIONS.OWNER_LOGIN_SUCCESS).toBe('OWNER_LOGIN_SUCCESS');
      expect(AUDIT_ACTIONS.OWNER_LOGIN_FAILED).toBe('OWNER_LOGIN_FAILED');
      expect(AUDIT_ACTIONS.OWNER_LOGOUT).toBe('OWNER_LOGOUT');
      expect(AUDIT_ACTIONS.OWNER_SESSION_REVOKED).toBe('OWNER_SESSION_REVOKED');
      expect(AUDIT_ACTIONS.SESSION_ROTATED).toBe('SESSION_ROTATED');
      expect(AUDIT_ACTIONS.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
    });
  });

  describe('auditDiffSchema', () => {
    it('accepts structured before and after mutation diffs', () => {
      const diff = {
        before: { status: 'ACTIVE', plan: 'BASIC' },
        after: { status: 'SUSPENDED', plan: 'BASIC' },
      };
      expect(auditDiffSchema.parse(diff)).toEqual(diff);
    });

    it('accepts null or undefined diffs', () => {
      expect(auditDiffSchema.parse(null)).toBeNull();
      expect(auditDiffSchema.parse(undefined)).toBeUndefined();
    });
  });

  describe('recordAuditEventSchema', () => {
    const validUuid1 = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '223e4567-e89b-12d3-a456-426614174001';

    it('validates a complete valid audit event payload', () => {
      const payload = {
        actorUserId: validUuid1,
        actorRole: 'SUPERADMIN',
        targetTenantId: validUuid2,
        module: AUDIT_MODULES.TENANT,
        eventType: AUDIT_EVENT_TYPES.TENANT_LIFECYCLE,
        action: 'TENANT_SUSPENDED',
        status: AUDIT_STATUS.SUCCESS,
        resourceType: 'TENANT',
        resourceId: validUuid2,
        metadata: {
          reason: 'Terms violation',
          diff: { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } },
        },
        supportSessionId: null,
        requestId: 'req-abc-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 Vitest',
      };

      const parsed = recordAuditEventSchema.parse(payload);
      expect(parsed.module).toBe('TENANT');
      expect(parsed.status).toBe('SUCCESS');
      expect(parsed.eventType).toBe('TENANT_LIFECYCLE');
    });

    it('defaults status to SUCCESS when omitted', () => {
      const payload = {
        module: AUDIT_MODULES.AUTH,
        eventType: 'LOGIN',
        action: 'SUPERADMIN_LOGIN',
      };
      const parsed = recordAuditEventSchema.parse(payload);
      expect(parsed.status).toBe('SUCCESS');
    });

    it('rejects payloads missing mandatory fields (module, eventType, action)', () => {
      expect(() => recordAuditEventSchema.parse({ eventType: 'TEST', action: 'TEST' })).toThrow();
      expect(() => recordAuditEventSchema.parse({ module: 'AUTH', action: 'TEST' })).toThrow();
      expect(() => recordAuditEventSchema.parse({ module: 'AUTH', eventType: 'TEST' })).toThrow();
      expect(() => recordAuditEventSchema.parse({ module: '', eventType: 'TEST', action: 'TEST' })).toThrow(/Module is required/i);
      expect(() => recordAuditEventSchema.parse({ module: 'AUTH', eventType: '', action: 'TEST' })).toThrow(/Event type is required/i);
      expect(() => recordAuditEventSchema.parse({ module: 'AUTH', eventType: 'TEST', action: '' })).toThrow(/Action is required/i);
    });

    it('rejects invalid UUIDs for actorUserId or targetTenantId', () => {
      expect(() =>
        recordAuditEventSchema.parse({
          actorUserId: 'not-a-uuid',
          module: 'AUTH',
          eventType: 'TEST',
          action: 'TEST',
        })
      ).toThrow(/Invalid actor user UUID/i);

      expect(() =>
        recordAuditEventSchema.parse({
          targetTenantId: 'not-a-uuid',
          module: 'AUTH',
          eventType: 'TEST',
          action: 'TEST',
        })
      ).toThrow(/Invalid target tenant UUID/i);
    });
  });
});
