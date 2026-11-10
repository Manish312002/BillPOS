import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db/client.js';
import {
  recordAuditEvent,
  sanitizeAuditMetadata,
  isSensitiveKey,
} from '../src/services/audit.service.js';
import { withTestAuditCleanup } from './helpers/testCleanup.js';

describe('Centralized Audit Service & Metadata Sanitization (Module 3.1)', () => {
  let testUser = null;
  let testTenant = null;
  const createdAuditIds = [];

  beforeAll(async () => {
    testUser = await prisma.user.create({
      data: {
        fullName: 'Audit Service Tester',
        email: `audit_tester_${Date.now()}@billingbuddy.com`,
        phone: `+91870${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'ACTIVE',
      },
    });

    testTenant = await prisma.tenant.create({
      data: {
        slug: `audit-test-tenant-${Date.now()}`,
        legalName: 'Audit Testing Ltd',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await withTestAuditCleanup(async () => {
      if (createdAuditIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
      }
      if (testTenant) {
        await prisma.tenant.delete({ where: { id: testTenant.id } }).catch(() => {});
      }
      if (testUser) {
        await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
      }
    });
  });

  describe('1. Metadata Secret Sanitization', () => {
    it('identifies sensitive key names regardless of casing and delimiters', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('passwordHash')).toBe(true);
      expect(isSensitiveKey('password_hash')).toBe(true);
      expect(isSensitiveKey('sessionToken')).toBe(true);
      expect(isSensitiveKey('raw_token')).toBe(true);
      expect(isSensitiveKey('tokenHash')).toBe(true);
      expect(isSensitiveKey('totpSecret')).toBe(true);
      expect(isSensitiveKey('secretEncrypted')).toBe(true);
      expect(isSensitiveKey('recoveryCodes')).toBe(true);
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('cookie')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('cvv')).toBe(true);
      expect(isSensitiveKey('cardNumber')).toBe(true);

      // Extended Module 3.1.1 keys
      expect(isSensitiveKey('credentials')).toBe(true);
      expect(isSensitiveKey('userCredentials')).toBe(true);
      expect(isSensitiveKey('bearer')).toBe(true);
      expect(isSensitiveKey('bearerToken')).toBe(true);
      expect(isSensitiveKey('jwt')).toBe(true);
      expect(isSensitiveKey('jwtToken')).toBe(true);
      expect(isSensitiveKey('auth')).toBe(true);
      expect(isSensitiveKey('authToken')).toBe(true);
      expect(isSensitiveKey('authorizationHeader')).toBe(true);
      expect(isSensitiveKey('authorization_header')).toBe(true);

      // Safe identifier keys should not be redacted
      expect(isSensitiveKey('invitationId')).toBe(false);
      expect(isSensitiveKey('userId')).toBe(false);
      expect(isSensitiveKey('tenantId')).toBe(false);
      expect(isSensitiveKey('authId')).toBe(false);
      expect(isSensitiveKey('jwtId')).toBe(false);
      expect(isSensitiveKey('bearerId')).toBe(false);
      expect(isSensitiveKey('legalName')).toBe(false);
      expect(isSensitiveKey('reason')).toBe(false);
    });

    it('redacts newly extended sensitive keys (credentials, bearer, jwt, auth, authorizationheader)', () => {
      const input = {
        authId: 'auth-record-1234',
        jwtId: 'jwt-header-id-5678',
        bearerId: 'bearer-client-id-999',
        credentials: { username: 'admin', secret: 'TopSecret' },
        bearer: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        jwt: 'header.payload.signature',
        auth: 'Basic dXNlcjpwYXNz',
        authorizationHeader: 'Bearer eyJhbGci...',
        nestedList: [
          { userCredentials: 'user-secret-1' },
          { authToken: 'opaque-token-2' },
        ],
      };

      const sanitized = sanitizeAuditMetadata(input);
      expect(sanitized.authId).toBe('auth-record-1234');
      expect(sanitized.jwtId).toBe('jwt-header-id-5678');
      expect(sanitized.bearerId).toBe('bearer-client-id-999');
      expect(sanitized.credentials).toBe('[REDACTED]');
      expect(sanitized.bearer).toBe('[REDACTED]');
      expect(sanitized.jwt).toBe('[REDACTED]');
      expect(sanitized.auth).toBe('[REDACTED]');
      expect(sanitized.authorizationHeader).toBe('[REDACTED]');
      expect(sanitized.nestedList[0].userCredentials).toBe('[REDACTED]');
      expect(sanitized.nestedList[1].authToken).toBe('[REDACTED]');
    });

    it('redacts sensitive values at top level and preserves safe values', () => {
      const input = {
        legalName: 'Test Store',
        password: 'PlainSecretPassword123!',
        tokenHash: 'abc123hash',
        reason: 'Authorized store creation',
      };

      const sanitized = sanitizeAuditMetadata(input);
      expect(sanitized.legalName).toBe('Test Store');
      expect(sanitized.reason).toBe('Authorized store creation');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.tokenHash).toBe('[REDACTED]');
    });

    it('recursively redacts sensitive values inside nested objects', () => {
      const input = {
        store: {
          name: 'Apex Mart',
          owner: {
            phone: '+919876543210',
            passwordHash: '$2b$12$securehashvalue',
            totpSecret: 'JBSWY3DPEHPK3PXP',
          },
        },
        diff: {
          before: { status: 'PENDING', secretEncrypted: 'enc-data-1' },
          after: { status: 'ACTIVE', secretEncrypted: 'enc-data-2' },
        },
      };

      const sanitized = sanitizeAuditMetadata(input);
      expect(sanitized.store.name).toBe('Apex Mart');
      expect(sanitized.store.owner.phone).toBe('+919876543210');
      expect(sanitized.store.owner.passwordHash).toBe('[REDACTED]');
      expect(sanitized.store.owner.totpSecret).toBe('[REDACTED]');
      expect(sanitized.diff.before.status).toBe('PENDING');
      expect(sanitized.diff.before.secretEncrypted).toBe('[REDACTED]');
      expect(sanitized.diff.after.status).toBe('ACTIVE');
      expect(sanitized.diff.after.secretEncrypted).toBe('[REDACTED]');
    });

    it('redacts sensitive values within arrays and arrays of objects', () => {
      const input = {
        tokens: ['raw-token-1', 'raw-token-2'],
        recoveryCodes: ['code-1', 'code-2'],
        items: [
          { sku: 'ITEM-1', price: 100 },
          { sku: 'ITEM-2', apiKey: 'secret-api-key' },
        ],
      };

      const sanitized = sanitizeAuditMetadata(input);
      expect(sanitized.tokens).toBe('[REDACTED]');
      expect(sanitized.recoveryCodes).toBe('[REDACTED]');
      expect(sanitized.items[0]).toEqual({ sku: 'ITEM-1', price: 100 });
      expect(sanitized.items[1].sku).toBe('ITEM-2');
      expect(sanitized.items[1].apiKey).toBe('[REDACTED]');
    });

    it('safely handles circular references without infinite loops', () => {
      const circular = { name: 'Root' };
      circular.self = circular;

      const sanitized = sanitizeAuditMetadata(circular);
      expect(sanitized.name).toBe('Root');
      expect(sanitized.self).toBe('[CIRCULAR]');
    });
  });

  describe('2. Centralized recordAuditEvent Service', () => {
    it('creates an audit event with full schema fields and auto-redacted metadata', async () => {
      const record = await recordAuditEvent({
        actorUserId: testUser.id,
        actorRole: 'SUPERADMIN',
        targetTenantId: testTenant.id,
        module: 'TENANT',
        eventType: 'TENANT_UPDATED',
        action: 'UPDATE_TENANT_SETTINGS',
        status: 'SUCCESS',
        resourceType: 'TENANT',
        resourceId: testTenant.id,
        metadata: {
          settingName: 'TaxRate',
          oldValue: 18,
          newValue: 12,
          password: 'should-be-redacted',
        },
        requestId: 'req-test-12345',
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest Unit Agent',
      });

      createdAuditIds.push(record.id);

      expect(record.id).toBeDefined();
      expect(record.module).toBe('TENANT');
      expect(record.actorRole).toBe('SUPERADMIN');
      expect(record.status).toBe('SUCCESS');
      expect(record.requestId).toBe('req-test-12345');
      expect(record.metadata.settingName).toBe('TaxRate');
      expect(record.metadata.password).toBe('[REDACTED]');
    });

    it('extracts request context automatically when req object is passed', async () => {
      const fakeReq = {
        ip: '10.0.0.42',
        headers: {
          'user-agent': 'Chrome Headless Agent',
          'x-request-id': 'req-corr-999',
        },
        user: { id: testUser.id },
        platformRole: 'SUPERADMIN',
        currentMembership: { tenantId: testTenant.id, role: 'STORE_OWNER' },
      };

      const record = await recordAuditEvent({
        req: fakeReq,
        module: 'AUTH',
        eventType: 'SECURITY_EVENT',
        action: 'TEST_CONTEXT_EXTRACTION',
      });

      createdAuditIds.push(record.id);

      expect(record.actorUserId).toBe(testUser.id);
      expect(record.actorRole).toBe('SUPERADMIN');
      expect(record.targetTenantId).toBe(testTenant.id);
      expect(record.ipAddress).toBe('10.0.0.42');
      expect(record.userAgent).toBe('Chrome Headless Agent');
      expect(record.requestId).toBe('req-corr-999');
    });

    it('preserves atomicity when executed inside an existing Prisma transaction', async () => {
      let createdInsideTx = null;

      await prisma.$transaction(async (tx) => {
        createdInsideTx = await recordAuditEvent({
          tx,
          actorUserId: testUser.id,
          targetTenantId: testTenant.id,
          module: 'TENANT',
          eventType: 'TENANT_TRANSACTION_TEST',
          action: 'TX_AUDIT_RECORD',
          metadata: { inTx: true },
        });

        expect(createdInsideTx.id).toBeDefined();
      });

      createdAuditIds.push(createdInsideTx.id);

      // Verify record exists after successful transaction commit
      const persisted = await prisma.auditLog.findUnique({
        where: { id: createdInsideTx.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted.eventType).toBe('TENANT_TRANSACTION_TEST');
    });

    it('aborts and rolls back entire transaction if an error occurs after audit call', async () => {
      let capturedAuditId = null;

      const txPromise = prisma.$transaction(async (tx) => {
        const audit = await recordAuditEvent({
          tx,
          actorUserId: testUser.id,
          targetTenantId: testTenant.id,
          module: 'TENANT',
          eventType: 'ROLLBACK_TEST',
          action: 'SHOULD_BE_ROLLED_BACK',
        });
        capturedAuditId = audit.id;

        // Force an intentional error to trigger transaction rollback
        throw new Error('Intentional transaction abort');
      });

      await expect(txPromise).rejects.toThrow('Intentional transaction abort');

      // Verify the audit event was rolled back and does not exist in the database
      const lookup = await prisma.auditLog.findUnique({
        where: { id: capturedAuditId },
      });
      expect(lookup).toBeNull();
    });

    it('rejects invalid payloads missing mandatory fields', async () => {
      await expect(
        recordAuditEvent({
          actorUserId: testUser.id,
          // Missing module, eventType, action
        })
      ).rejects.toThrow();
    });

    describe('3. Actor Resolution & Explicit Null Preservation (SEC-AUD-02)', () => {
      it('preserves explicit actorUserId: null even when req.user is populated', async () => {
        const record = await recordAuditEvent({
          actorUserId: null,
          module: 'AUTH',
          eventType: 'SECURITY_AUTH',
          action: 'EXPLICIT_NULL_USER_TEST',
          req: {
            user: { id: testUser.id, platformAuthorization: { role: 'SUPERADMIN' } },
            ip: '127.0.0.1',
          },
        });

        createdAuditIds.push(record.id);
        expect(record.actorUserId).toBeNull();
      });

      it('preserves explicit actorUserId: null even when req.session is populated', async () => {
        const record = await recordAuditEvent({
          actorUserId: null,
          module: 'AUTH',
          eventType: 'SECURITY_AUTH',
          action: 'EXPLICIT_NULL_SESSION_TEST',
          req: {
            session: { userId: testUser.id },
            ip: '127.0.0.1',
          },
        });

        createdAuditIds.push(record.id);
        expect(record.actorUserId).toBeNull();
      });

      it('extracts req.user.id when actorUserId is omitted', async () => {
        const record = await recordAuditEvent({
          module: 'AUTH',
          eventType: 'SECURITY_AUTH',
          action: 'OMITTED_ACTOR_USER_TEST',
          req: {
            user: { id: testUser.id, platformAuthorization: { role: 'SUPERADMIN' } },
            ip: '127.0.0.1',
          },
        });

        createdAuditIds.push(record.id);
        expect(record.actorUserId).toBe(testUser.id);
        expect(record.actorRole).toBe('SUPERADMIN');
      });

      it('extracts req.session.userId when actorUserId and req.user are omitted', async () => {
        const record = await recordAuditEvent({
          module: 'AUTH',
          eventType: 'SECURITY_AUTH',
          action: 'OMITTED_ACTOR_SESSION_TEST',
          req: {
            session: { userId: testUser.id },
            ip: '127.0.0.1',
          },
        });

        createdAuditIds.push(record.id);
        expect(record.actorUserId).toBe(testUser.id);
      });

      it('preserves explicitly supplied actorUserId over req.user.id', async () => {
        const otherUserId = testUser.id;
        const record = await recordAuditEvent({
          actorUserId: otherUserId,
          module: 'AUTH',
          eventType: 'SECURITY_AUTH',
          action: 'EXPLICIT_ACTOR_OVERRIDE_TEST',
          req: {
            user: { id: 'different-req-user-id' },
            ip: '127.0.0.1',
          },
        });

        createdAuditIds.push(record.id);
        expect(record.actorUserId).toBe(otherUserId);
      });
    });
  });
});
