import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db/client.js';
import { executeTestCleanup, validateTestDatabase } from './helpers/testCleanup.js';

describe('PostgreSQL AuditLog Hardened Immutability & Referential Integrity (Module 3.1.1)', () => {
  let sampleAuditId = null;
  let testUser = null;
  let testTenant = null;

  beforeAll(async () => {
    // Verify database connection is pointing to dedicated test DB
    await validateTestDatabase(prisma);

    testUser = await prisma.user.create({
      data: {
        fullName: 'Immutability FK Tester',
        email: `immutability_fk_${Date.now()}@billingbuddy.com`,
        phone: `+91971${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'ACTIVE',
      },
    });

    testTenant = await prisma.tenant.create({
      data: {
        legalName: 'FK Restrict Test Co',
        slug: `fk-restrict-${Date.now()}`,
        status: 'ACTIVE',
      },
    });

    const audit = await prisma.auditLog.create({
      data: {
        actorUserId: testUser.id,
        targetTenantId: testTenant.id,
        eventType: 'IMMUTABILITY_TEST',
        action: 'TEST_INSERT',
        module: 'SYSTEM',
        status: 'SUCCESS',
        metadata: { purpose: 'Verify unconditional append-only enforcement' },
      },
    });

    sampleAuditId = audit.id;
    expect(sampleAuditId).toBeDefined();
  });

  afterAll(async () => {
    // Controlled teardown using dedicated test database cleanup helper
    await executeTestCleanup(async () => {
      if (sampleAuditId) {
        await prisma.auditLog.deleteMany({ where: { id: sampleAuditId } });
      }
      if (testTenant) {
        await prisma.tenant.delete({ where: { id: testTenant.id } }).catch(() => {});
      }
      if (testUser) {
        await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
      }
    });
  });

  // 1. INSERT succeeds
  it('permits standard INSERT operations into AuditLog', async () => {
    const extraAudit = await prisma.auditLog.create({
      data: {
        eventType: 'IMMUTABILITY_TEST',
        action: 'SECOND_INSERT',
        module: 'SYSTEM',
        status: 'SUCCESS',
      },
    });

    expect(extraAudit.id).toBeDefined();

    await executeTestCleanup(async () => {
      await prisma.auditLog.deleteMany({ where: { id: extraAudit.id } });
    });
  });

  // 2. UPDATE always fails unconditionally
  it('rejects direct SQL UPDATE attempts unconditionally with P0001 exception', async () => {
    const updateAttempt = prisma.$executeRawUnsafe(
      `UPDATE "AuditLog" SET "action" = 'TAMPERED_ACTION' WHERE "id" = '${sampleAuditId}'`
    );

    await expect(updateAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );

    // Verify record in database was NOT altered
    const record = await prisma.auditLog.findUnique({
      where: { id: sampleAuditId },
    });
    expect(record.action).toBe('TEST_INSERT');
  });

  // 3. DELETE always fails unconditionally
  it('rejects direct SQL DELETE attempts unconditionally with P0001 exception', async () => {
    const deleteAttempt = prisma.$executeRawUnsafe(
      `DELETE FROM "AuditLog" WHERE "id" = '${sampleAuditId}'`
    );

    await expect(deleteAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );

    // Verify record in database was NOT deleted
    const record = await prisma.auditLog.findUnique({
      where: { id: sampleAuditId },
    });
    expect(record).not.toBeNull();
  });

  // 4. TRUNCATE is rejected via statement-level trigger
  it('rejects TRUNCATE TABLE AuditLog via statement-level trigger trg_audit_log_truncate', async () => {
    const truncateAttempt = prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"');

    await expect(truncateAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );
  });

  // 5. Setting app.allow_test_audit_cleanup cannot bypass protection
  it('guarantees setting app.allow_test_audit_cleanup has ZERO effect and cannot bypass protection', async () => {
    await prisma.$executeRawUnsafe("SET app.allow_test_audit_cleanup = 'on'");

    const updateAttempt = prisma.$executeRawUnsafe(
      `UPDATE "AuditLog" SET "action" = 'MALICIOUS_BYPASS' WHERE "id" = '${sampleAuditId}'`
    );

    await expect(updateAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );

    const deleteAttempt = prisma.$executeRawUnsafe(
      `DELETE FROM "AuditLog" WHERE "id" = '${sampleAuditId}'`
    );

    await expect(deleteAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );

    await prisma.$executeRawUnsafe("SET app.allow_test_audit_cleanup = 'off'");
  });

  // 6. Prisma ORM delete rejects
  it('rejects Prisma ORM delete without test cleanup helper', async () => {
    const prismaDeleteAttempt = prisma.auditLog.delete({
      where: { id: sampleAuditId },
    });

    await expect(prismaDeleteAttempt).rejects.toThrow(
      /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
    );
  });

  // 7. Multi-Tier Database Isolation Tests (Positive & Negative)
  describe('7. Multi-Tier Test Database Isolation & Fail-Closed Guardrails', () => {
    it('positively validates the active dedicated test database (billpos_test) with non-superuser role', async () => {
      const result = await validateTestDatabase(prisma);
      expect(result.dbName).toBe('billpos_test');
      expect(result.dbUser).toBe('billpos_test_admin');
      expect(result.isSuperuser).toBe(false);
      expect(result.hasCreaterole).toBe(false);
      expect(result.hasCreatedb).toBe(false);
      expect(result.hasReplication).toBe(false);
      expect(result.hasBypassrls).toBe(false);
      expect(result.serverPort).toBe(5432);
    });

    it('rejects an unexpected remote database host configured in DATABASE_URL', async () => {
      const originalDbUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = 'postgresql://billpos_test_admin:pass@remote-prod-db.internal:5432/billpos_test?schema=public';
        const mockDb = {
          $queryRawUnsafe: async () => [{
            db_name: 'billpos_test',
            db_user: 'billpos_test_admin',
            session_user: 'billpos_test_admin',
            server_addr: '127.0.0.1',
            is_superuser: false,
          }],
        };
        await expect(validateTestDatabase(mockDb)).rejects.toThrow(
          /Configured database host 'remote-prod-db.internal' is not an authorized test host/i
        );
      } finally {
        process.env.DATABASE_URL = originalDbUrl;
      }
    });

    it('rejects an unexpected remote database IP configured in DATABASE_URL', async () => {
      const originalDbUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = 'postgresql://billpos_test_admin:pass@10.0.0.15:5432/billpos_test?schema=public';
        const mockDb = {
          $queryRawUnsafe: async () => [{
            db_name: 'billpos_test',
            db_user: 'billpos_test_admin',
            session_user: 'billpos_test_admin',
            server_addr: '127.0.0.1',
            is_superuser: false,
          }],
        };
        await expect(validateTestDatabase(mockDb)).rejects.toThrow(
          /Configured database host '10.0.0.15' is not an authorized test host/i
        );
      } finally {
        process.env.DATABASE_URL = originalDbUrl;
      }
    });

    it('rejects a live connection reporting a remote server IP (inet_server_addr)', async () => {
      const mockRemoteDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '54.210.12.89', // simulated remote cloud IP
          server_port: 5432,
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockRemoteDb)).rejects.toThrow(
        /Connected database server address '54.210.12.89' is not an authorized local test host/i
      );
    });

    it('rejects correct database name connected through an incorrect host', async () => {
      const originalDbUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = 'postgresql://billpos_test_admin:pass@staging-cluster.internal:5432/billpos_test?schema=public';
        const mockDb = {
          $queryRawUnsafe: async () => [{
            db_name: 'billpos_test',
            db_user: 'billpos_test_admin',
            session_user: 'billpos_test_admin',
            server_addr: '192.168.1.100',
            is_superuser: false,
          }],
        };
        await expect(validateTestDatabase(mockDb)).rejects.toThrow(
          /not an authorized test host/i
        );
      } finally {
        process.env.DATABASE_URL = originalDbUrl;
      }
    });

    it('rejects superuser roles (e.g. postgres with rolsuper = true)', async () => {
      const mockSuperuserDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'postgres',
          session_user: 'postgres',
          server_addr: '127.0.0.1',
          is_superuser: true,
        }],
      };
      await expect(validateTestDatabase(mockSuperuserDb)).rejects.toThrow(
        /has superuser privileges \(rolsuper = true\)/i
      );
    });

    it('rejects roles with excessive administrative privileges (createrole/createdb/replication/bypassrls)', async () => {
      const mockExcessiveCreaterole = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
          has_createrole: true,
        }],
      };
      await expect(validateTestDatabase(mockExcessiveCreaterole)).rejects.toThrow(
        /possesses excessive administrative privileges/i
      );

      const mockExcessiveCreatedb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
          has_createdb: true,
        }],
      };
      await expect(validateTestDatabase(mockExcessiveCreatedb)).rejects.toThrow(
        /possesses excessive administrative privileges/i
      );
    });

    it('rejects postgres even when rolsuper is false because it is removed from test cleanup role allowlist', async () => {
      const mockPostgresDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'postgres',
          session_user: 'postgres',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockPostgresDb)).rejects.toThrow(
        /not in the allowlist of approved test cleanup roles/i
      );
    });

    it('positively accepts dedicated non-superuser test cleanup roles (billpos_test_admin, billingbuddy_test_admin)', async () => {
      const mockAdminDb1 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
          has_createrole: false,
          has_createdb: false,
          has_replication: false,
          has_bypassrls: false,
        }],
      };
      const res1 = await validateTestDatabase(mockAdminDb1);
      expect(res1.dbUser).toBe('billpos_test_admin');
      expect(res1.isSuperuser).toBe(false);

      const mockAdminDb2 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billingbuddy_test',
          db_user: 'billingbuddy_test_admin',
          session_user: 'billingbuddy_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
          has_createrole: false,
          has_createdb: false,
          has_replication: false,
          has_bypassrls: false,
        }],
      };
      const res2 = await validateTestDatabase(mockAdminDb2);
      expect(res2.dbUser).toBe('billingbuddy_test_admin');
      expect(res2.isSuperuser).toBe(false);
    });

    it('rejects unauthorized application database role (billpos_app, app_user)', async () => {
      const mockAppRoleDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_app',
          session_user: 'billpos_app',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockAppRoleDb)).rejects.toThrow(
        /forbidden application\/unprivileged role/i
      );
    });

    it('rejects correct host connected with an unauthorized role (localhost with unauthorized_role)', async () => {
      const mockUnauthorizedRoleDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'unauthorized_developer',
          session_user: 'unauthorized_developer',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockUnauthorizedRoleDb)).rejects.toThrow(
        /not in the allowlist of approved test cleanup roles/i
      );
    });

    it('rejects role mismatch between current_user and session_user (impersonation defense)', async () => {
      const mockImpersonationDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_test',
          db_user: 'billpos_test_admin',
          db_session_user: 'billpos_app',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockImpersonationDb)).rejects.toThrow(
        /Role mismatch detected/i
      );
    });

    it('confirms cleanup rejection occurs before any DDL or ALTER TABLE execution', async () => {
      let ddlExecuted = false;
      const mockFailingDb = {
        $queryRawUnsafe: async (sql) => {
          if (sql.includes('ALTER TABLE')) {
            ddlExecuted = true;
          }
          // Return an unauthorized role
          return [{
            db_name: 'billpos_test',
            db_user: 'unauthorized_role',
            session_user: 'unauthorized_role',
            server_addr: '127.0.0.1',
            is_superuser: false,
          }];
        },
      };

      await expect(executeTestCleanup(async () => {}, mockFailingDb)).rejects.toThrow(
        /not in the allowlist of approved test cleanup roles/i
      );

      expect(ddlExecuted).toBe(false);
    });

    it('rejects development database (billpos)', async () => {
      const mockDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockDb)).rejects.toThrow(
        /forbidden development\/production database/i
      );
    });

    it('rejects staging databases (billpos_staging, billingbuddy_staging)', async () => {
      const mockStagingDb1 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_staging',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockStagingDb1)).rejects.toThrow(
        /forbidden development\/production database/i
      );

      const mockStagingDb2 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billingbuddy_staging',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockStagingDb2)).rejects.toThrow(
        /forbidden development\/production database/i
      );
    });

    it('rejects production databases (billpos_production, billingbuddy_prod)', async () => {
      const mockProdDb1 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billpos_production',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockProdDb1)).rejects.toThrow(
        /forbidden development\/production database/i
      );

      const mockProdDb2 = {
        $queryRawUnsafe: async () => [{
          db_name: 'billingbuddy_prod',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockProdDb2)).rejects.toThrow(
        /forbidden development\/production database/i
      );
    });

    it('rejects system databases (postgres, template1)', async () => {
      const mockSysDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'postgres',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockSysDb)).rejects.toThrow(
        /forbidden development\/production database/i
      );
    });

    it('rejects unauthorized databases even if they end with _test (evil_test, arbitrary_test)', async () => {
      const mockUnauthorizedTestDb = {
        $queryRawUnsafe: async () => [{
          db_name: 'evil_test',
          db_user: 'billpos_test_admin',
          session_user: 'billpos_test_admin',
          server_addr: '127.0.0.1',
          is_superuser: false,
        }],
      };
      await expect(validateTestDatabase(mockUnauthorizedTestDb)).rejects.toThrow(
        /not in the allowlist of approved test databases/i
      );
    });

    it('rejects execution when NODE_ENV is not "test"', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const mockDb = {
          $queryRawUnsafe: async () => [{ db_name: 'billpos_test', db_user: 'postgres' }],
        };
        await expect(validateTestDatabase(mockDb)).rejects.toThrow(
          /NODE_ENV must be 'test'/i
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('rejects unresolvable or empty database identity', async () => {
      const mockEmptyDb = {
        $queryRawUnsafe: async () => [],
      };
      await expect(validateTestDatabase(mockEmptyDb)).rejects.toThrow(
        /Could not resolve database identity/i
      );
    });

    it('guarantees triggers are re-enabled in finally even if cleanupFn throws an error', async () => {
      const errorThrowingCleanup = async () => {
        throw new Error('INTENTIONAL_CLEANUP_FAILURE');
      };

      await expect(executeTestCleanup(errorThrowingCleanup)).rejects.toThrow(
        'INTENTIONAL_CLEANUP_FAILURE'
      );

      // Verify trigger is enabled by attempting an unauthorized update (which must fail with P0001)
      const updateAttempt = prisma.$executeRawUnsafe(
        `UPDATE "AuditLog" SET "action" = 'MALICIOUS_AFTER_FAILURE' WHERE "id" = '${sampleAuditId}'`
      );
      await expect(updateAttempt).rejects.toThrow(
        /AuditLog records are append-only and cannot be updated, deleted, or truncated/i
      );
    });
  });

  // 8. User deletion with audit history is rejected via ON DELETE RESTRICT
  it('rejects hard deletion of a User who has audit history due to ON DELETE RESTRICT', async () => {
    const deleteUserAttempt = prisma.user.delete({
      where: { id: testUser.id },
    });

    await expect(deleteUserAttempt).rejects.toThrow();

    // Verify user still exists in database
    const userInDb = await prisma.user.findUnique({
      where: { id: testUser.id },
    });
    expect(userInDb).not.toBeNull();
  });

  // 9. Tenant deletion with audit history is rejected via ON DELETE RESTRICT
  it('rejects hard deletion of a Tenant who has audit history due to ON DELETE RESTRICT', async () => {
    const deleteTenantAttempt = prisma.tenant.delete({
      where: { id: testTenant.id },
    });

    await expect(deleteTenantAttempt).rejects.toThrow();

    // Verify tenant still exists in database
    const tenantInDb = await prisma.tenant.findUnique({
      where: { id: testTenant.id },
    });
    expect(tenantInDb).not.toBeNull();
  });

  // 10. executeTestCleanup works strictly on test database
  it('permits test cleanup strictly through executeTestCleanup on test database', async () => {
    const ephemeral = await prisma.auditLog.create({
      data: {
        eventType: 'IMMUTABILITY_TEST',
        action: 'EPHEMERAL_RECORD',
        module: 'SYSTEM',
      },
    });

    await expect(
      executeTestCleanup(async () => {
        return await prisma.auditLog.delete({ where: { id: ephemeral.id } });
      })
    ).resolves.toBeDefined();

    const lookup = await prisma.auditLog.findUnique({
      where: { id: ephemeral.id },
    });
    expect(lookup).toBeNull();
  });
});
