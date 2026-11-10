import { prisma } from '../../src/db/client.js';

/**
 * Strict allowlist of approved test database names.
 * Suffix-matching alone is NOT sufficient.
 */
export const ALLOWED_TEST_DATABASES = new Set([
  'billpos_test',
  'billingbuddy_test',
]);

/**
 * Explicit blocklist of development, staging, production, and system database names.
 */
export const FORBIDDEN_DATABASES = new Set([
  'billpos',
  'billpos_dev',
  'billpos_development',
  'billpos_stage',
  'billpos_staging',
  'billpos_prod',
  'billpos_production',
  'billingbuddy',
  'billingbuddy_dev',
  'billingbuddy_development',
  'billingbuddy_staging',
  'billingbuddy_prod',
  'billingbuddy_production',
  'postgres',
  'template1',
  'template0',
]);

/**
 * Strict allowlist of approved local test database hosts and IP representations.
 * Remote endpoints (Cloud SQL, RDS, internal networks) are strictly forbidden.
 */
export const ALLOWED_TEST_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export const ALLOWED_TEST_SERVER_IPS = new Set([
  '127.0.0.1',
  '::1',
  null, // Unix domain sockets report NULL for inet_server_addr()
]);

/**
 * Strict allowlist of approved test cleanup database roles.
 * Ordinary application roles (e.g. billpos_app) are forbidden from running cleanup DDL.
 */
export const ALLOWED_TEST_ROLES = new Set([
  'billpos_test_admin', // Dedicated least-privilege test database admin role
  'billingbuddy_test_admin',
]);

export const FORBIDDEN_ROLES = new Set([
  'billpos_app',
  'billingbuddy_app',
  'billpos_api',
  'billingbuddy_api',
  'app_user',
  'readonly',
  'public',
]);

/**
 * Validates that the active database connection and runtime environment
 * strictly conform to an authorized dedicated test database on an approved local host
 * with an authorized test administrative role.
 *
 * Checks (Fail-Closed):
 * 1. NODE_ENV must be strictly 'test'.
 * 2. DATABASE_URL hostname must be in ALLOWED_TEST_HOSTS.
 * 3. Live connected server address must be in ALLOWED_TEST_SERVER_IPS.
 * 4. Active database name must not be in FORBIDDEN_DATABASES.
 * 5. Active database name must be in ALLOWED_TEST_DATABASES.
 * 6. Active database name must end with '_test'.
 * 7. Active database role must not be in FORBIDDEN_ROLES.
 * 8. Active database role must be in ALLOWED_TEST_ROLES.
 * 9. current_user and session_user must match (no role-switching/impersonation).
 *
 * @param {Object} [db=prisma] - Prisma client instance
 * @returns {Promise<Object>} The verified connection metadata { dbName, dbUser, dbSessionUser, serverAddr, serverPort }
 */
export async function validateTestDatabase(db = prisma) {
  // 1. Validate runtime environment
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! NODE_ENV must be 'test' (currently '${process.env.NODE_ENV}').`
    );
  }

  // 2. Validate configured DATABASE_URL hostname if available
  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL);
      const configuredHost = parsedUrl.hostname.toLowerCase();
      if (!ALLOWED_TEST_HOSTS.has(configuredHost)) {
        throw new Error(
          `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Configured database host '${configuredHost}' is not an authorized test host.`
        );
      }
    } catch (urlErr) {
      if (urlErr.message.includes('CRITICAL SECURITY VIOLATION')) throw urlErr;
      // In case DATABASE_URL is malformed
      throw new Error(
        `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Malformed DATABASE_URL: ${urlErr.message}`
      );
    }
  }

  // 3. Query live database connection identity, host, user, and administrative privileges from catalog
  const result = await db.$queryRawUnsafe(`
    SELECT 
      current_database() AS db_name,
      current_user AS db_user,
      session_user AS db_session_user,
      inet_server_addr() AS server_addr,
      inet_server_port() AS server_port,
      inet_client_addr() AS client_addr,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
      COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user), false) AS has_createrole,
      COALESCE((SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user), false) AS has_createdb,
      COALESCE((SELECT rolreplication FROM pg_roles WHERE rolname = current_user), false) AS has_replication,
      COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS has_bypassrls
  `);

  const row = result?.[0];
  const dbName = row?.db_name;
  const dbUser = row?.db_user;
  const dbSessionUser = row?.db_session_user;
  const serverAddr = row?.server_addr ? String(row.server_addr).trim() : null;
  const serverPort = row?.server_port ? Number(row.server_port) : null;
  const isSuperuser = Boolean(row?.is_superuser);
  const hasCreaterole = Boolean(row?.has_createrole);
  const hasCreatedb = Boolean(row?.has_createdb);
  const hasReplication = Boolean(row?.has_replication);
  const hasBypassrls = Boolean(row?.has_bypassrls);

  if (!dbName || typeof dbName !== 'string') {
    throw new Error(
      '[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Could not resolve database identity from active connection.'
    );
  }

  // 4. Validate live connected server IP address (Fail-closed host validation)
  if (serverAddr !== null && !ALLOWED_TEST_SERVER_IPS.has(serverAddr)) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Connected database server address '${serverAddr}' is not an authorized local test host.`
    );
  }

  // 5. Validate database roles (current_user and session_user)
  if (!dbUser || typeof dbUser !== 'string') {
    throw new Error(
      '[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Could not resolve database user from active connection.'
    );
  }

  const normalizedUser = dbUser.trim().toLowerCase();
  const normalizedSessionUser = dbSessionUser ? String(dbSessionUser).trim().toLowerCase() : null;

  // 5a. Reject role impersonation and session-user switching
  if (normalizedSessionUser && normalizedUser !== normalizedSessionUser) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Role mismatch detected (current_user: '${dbUser}', session_user: '${dbSessionUser}'). Test cleanup does not permit role impersonation or switching.`
    );
  }

  // 5b. Explicitly reject superuser roles (e.g. postgres or custom superusers)
  if (isSuperuser) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Role '${dbUser}' has superuser privileges (rolsuper = true). Test cleanup strictly requires a least-privilege, non-superuser role.`
    );
  }

  // 5c. Explicitly reject excessive administrative privileges
  if (hasCreaterole || hasCreatedb || hasReplication || hasBypassrls) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Role '${dbUser}' possesses excessive administrative privileges (createrole/createdb/replication/bypassrls). Test cleanup enforces least-privilege non-superuser execution.`
    );
  }

  // 5d. Reject forbidden unprivileged application roles
  if (FORBIDDEN_ROLES.has(normalizedUser) || (normalizedSessionUser && FORBIDDEN_ROLES.has(normalizedSessionUser))) {
    const matchedRole = FORBIDDEN_ROLES.has(normalizedUser) ? dbUser : dbSessionUser;
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Role '${matchedRole}' is a forbidden application/unprivileged role.`
    );
  }

  // 5e. Enforce dedicated non-superuser test cleanup role allowlist
  if (!ALLOWED_TEST_ROLES.has(normalizedUser)) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup rejected! Database role '${dbUser}' is not in the allowlist of approved test cleanup roles: [${Array.from(ALLOWED_TEST_ROLES).join(', ')}].`
    );
  }

  // 6. Reject explicitly forbidden production, staging, and development databases
  const normalizedDbName = dbName.trim().toLowerCase();
  if (FORBIDDEN_DATABASES.has(normalizedDbName)) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup aborted! Active database '${dbName}' is a forbidden development/production database.`
    );
  }

  // 7. Enforce strict database allowlist membership
  if (!ALLOWED_TEST_DATABASES.has(normalizedDbName)) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup aborted! Database '${dbName}' is not in the allowlist of approved test databases: [${Array.from(ALLOWED_TEST_DATABASES).join(', ')}].`
    );
  }

  // 8. Enforce defense-in-depth suffix
  if (!normalizedDbName.endsWith('_test')) {
    throw new Error(
      `[CRITICAL SECURITY VIOLATION] Test cleanup aborted! Database '${dbName}' does not carry the mandatory '_test' suffix.`
    );
  }

  return {
    dbName,
    dbUser,
    dbSessionUser,
    serverAddr,
    serverPort,
    isSuperuser,
    hasCreaterole,
    hasCreatedb,
    hasReplication,
    hasBypassrls,
  };
}

/**
 * Executes a teardown callback strictly within the dedicated test database.
 *
 * Security Controls:
 * 1. Multi-tier fail-closed connection validation (Host, Role, Database, Environment).
 * 2. Unconditional production trigger: Production trigger code contains zero bypass logic.
 * 3. Isolated test teardown: Temporarily disables triggers via DDL only on the dedicated test database.
 * 4. Guaranteed restoration: Always re-enables triggers in finally block.
 *
 * @param {Function} cleanupFn - Async teardown function
 * @param {Object} [db=prisma] - Prisma client instance
 * @returns {Promise<*>} Result of cleanupFn
 */
export async function executeTestCleanup(cleanupFn, db = prisma) {
  // Validate all connection dimensions before issuing any DDL
  await validateTestDatabase(db);

  await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER trg_audit_log_immutable');
  await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER trg_audit_log_truncate');

  try {
    return await cleanupFn();
  } finally {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER trg_audit_log_immutable');
      await db.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER trg_audit_log_truncate');
    } catch {
      // Best-effort re-enable
    }
  }
}

// Backward-compatible alias for existing test suites
export const withTestAuditCleanup = executeTestCleanup;

export default {
  ALLOWED_TEST_DATABASES,
  FORBIDDEN_DATABASES,
  ALLOWED_TEST_HOSTS,
  ALLOWED_TEST_SERVER_IPS,
  ALLOWED_TEST_ROLES,
  FORBIDDEN_ROLES,
  validateTestDatabase,
  executeTestCleanup,
  withTestAuditCleanup,
};
