# 10. Audit Persistence Atomicity & Consistency Strategy

## Status
Accepted (Module 3.2.1.5 Authorized Implementation)

## Context
During the Module 3.2.1 security audit, finding SEC-AUD-04 identified non-transactional audit persistence across authentication lifecycle operations. State-mutating operations (`loginSuperadmin`, `loginOwner`, `logout`, and standalone `revokeSession`) modified the operational `Session` table in one database statement and subsequently recorded the corresponding `AuditLog` entry in an independent call.

If a connection failure, process crash, or database constraint error occurred between these calls:
1. **Un-Audited Active Sessions:** An active session could be committed to the database and issued to a client without any forensic record in `AuditLog`, violating non-repudiation.
2. **Permanent Audit Loss on Logout:** A session could be marked revoked in the database while the `USER_LOGGED_OUT` audit write failed. Subsequent client retries would observe an already-revoked session and early-return, permanently dropping the logout audit event.
3. **Ambiguous Error Status on Rejection:** If audit logging failed during an authentication rejection (e.g. bad credentials, CSRF failure, expired session), the unhandled database error would convert an intended `401 Unauthorized` or `403 Forbidden` into a `500 Internal Server Error`.
4. **HttpOnly Cookie Retention:** Because the `/api/auth/logout` endpoint previously mounted standard `authenticate` middleware, a client presenting an already-revoked session or unknown token was rejected with `401 Unauthorized` before reaching `clearSessionCookie(res)`. Because the cookie is HttpOnly, browser JavaScript cannot clear it, trapping the dead cookie in the client's browser.

This document establishes the transaction boundaries, ordering guarantees, error handling policies, cookie clearance lifecycles, and retry semantics for all authentication audit events.

---

## Decision

BillingBuddy adopts **Hybrid Atomic Persistence (Option A with Safe Rejection Logging)**:

1. **Shared Interactive Transactions for State-Mutating Operations (Option A):**
   All operations that mutate operational state (`Session` creation, session rotation, session revocation, tenant status updates, invitation activation) MUST execute within an interactive Prisma transaction (`prisma.$transaction(async (tx) => { ... })`).
   - The operational mutation and the `AuditLog` insertion share the same transaction delegate (`tx`).
   - If writing to `AuditLog` fails, the transaction rolls back completely.
   - No session can exist or be revoked without a committed audit event.

2. **Safe Operational Logging for Authentication Rejections (SEC-ADR-04):**
   Operations that do not mutate application or session state (failed logins, expired tokens, inactive user access attempts, CSRF rejections, malformed/unknown tokens on logout) execute standalone `AuditLog` writes via `recordSecurityRejectionAuditSafe()` outside of a transaction.
   - If `recordAuditEvent()` throws an error during an authentication rejection, the error MUST be caught locally.
   - The original security rejection response (`401 Unauthorized`, `403 Forbidden`, `429 Too Many Requests`) is preserved and returned to the client.
   - The persistence failure MUST NOT be silently swallowed; it must be emitted to the server's structured operational log (`console.error('[AUDIT_PERSISTENCE_FAILED]', ...)`) using strictly allowlisted diagnostic fields.
   - Under no circumstances may raw audit payloads, error messages, stack traces, passwords, password hashes, raw session tokens, cookies, authorization headers, secrets, or unmasked personal identifiers be logged.

3. **Rejection of the Transactional Outbox Pattern (Option B):**
   The Transactional Outbox pattern is explicitly rejected. In BillingBuddy, `Session` and `AuditLog` are co-located in the same PostgreSQL database. Introducing outbox tables, background relay workers, and message queues adds significant latency and operational fragility with zero consistency benefit over native PostgreSQL transactions.

---

## Transaction Policy by Operation

| Operation | Target State Mutation | Transaction Policy | Status |
| :--- | :--- | :--- | :--- |
| **Session Rotation** | Mark pending session rotated, create active session, invalidate recovery codes | Shared `prisma.$transaction` (`tx`) | **Implemented** (`auth.service.js:71-123`) |
| **Tenant Suspension** | Update tenant status to `SUSPENDED`, bulk-revoke all tenant sessions | Shared `prisma.$transaction` (`tx`) | **Implemented** (`tenant.service.js:643-680`) |
| **Owner Invitation Activation** | Accept invite, update user/store, record `ACTIVATE_TENANT`, create session | Shared `prisma.$transaction` (`tx`) | **Implemented** (`auth.service.js:1240-1473`) |
| **Superadmin Login** | Insert new `Session` row | Shared `prisma.$transaction` (`tx`) | **Implemented** (`auth.service.js:338-372`) |
| **Store Owner Login** | Update `User.lastLoginAt`, insert new `Session` row | Shared `prisma.$transaction` (`tx`) | **Implemented** (`auth.service.js:1830-1880`) |
| **User Logout (Active)** | Update `Session.revokedAt = NOW()` | Shared `prisma.$transaction` (`tx`) with conditional update (`count === 1`) | **Implemented** (`auth.service.js:910-955`) |
| **Administrative Revocation** | Update `Session.revokedAt = NOW()` | Shared `prisma.$transaction` (`tx`) with conditional update (`count === 1`) | **Implemented** (`auth.service.js:960-1010`) |
| **Failed Logins (All Roles)** | None (Read-only credential verification) | Standalone single-statement write with safe operational error trap | **Implemented** (`auth.service.js`) |
| **Session Validation Rejection** | None (Read-only token inspection) | Standalone single-statement write with safe operational error trap | **Implemented** (`auth.js`) |
| **CSRF Validation Rejection** | None (Read-only origin inspection) | Standalone single-statement write with safe operational error trap | **Implemented** (`csrf.js`) |
| **Logout Malformed/Unknown Token** | None (Unauthenticated token rejection) | Standalone single-statement write (`SESSION_VALIDATION_FAILED`) with safe error trap | **Implemented** (`auth.routes.js:logout`) |

---

## Token Generation and Cookie Issuance Ordering

To prevent leaking valid authentication credentials if a transaction fails to commit, the system enforces a strict 5-stage lifecycle across service and route boundaries:

```
[ Route Layer ]                    [ Service Layer ]                     [ PostgreSQL Engine ]
       |                                   |                                        |
       |--- 1. Call loginSuperadmin() ---->|                                        |
       |                                   |-- 2. Generate token in-memory -------->| (crypto.randomBytes)
       |                                   |                                        |
       |                                   |-- 3. Begin prisma.$transaction ------->|
       |                                   |      - INSERT Session (tokenHash)      |
       |                                   |      - INSERT AuditLog (LOGIN_SUCCESS) |
       |                                   |<-- 4. COMMIT Transaction --------------|
       |                                   |                                        |
       |<-- 5. Return { sessionToken } ----|                                        |
       |                                                                            |
       |-- 6. setSessionCookie(res, token)                                          |
       |-- 7. Return 200 OK                                                         |
```

1. **In-Memory Generation:** The opaque 256-bit session token is generated in Node.js memory (`generateOpaqueToken(32)`).
2. **Transaction Execution:** `Session` creation (storing SHA-256 hash) and `AuditLog` creation execute in one `prisma.$transaction`.
3. **Commit Verification:** Execution halts until PostgreSQL confirms the transaction commit.
4. **Service Boundary Return:** Only after commit does the service return the unhashed token to the route handler.
5. **Cookie Issuance:** Only upon receiving the resolved service payload does the route handler call `setSessionCookie()` and write headers to the client.

If the transaction rolls back or is aborted before commit, the service throws an exception, the route handler never receives the token, and no cookie is issued.

---

## Retry, Concurrency, and Idempotency Semantics

### 1. Login Retry & Commit Ambiguity Semantics
- **Non-Idempotency:** Login operations are **non-idempotent**.
- **PostgreSQL Transaction Atomicity:** PostgreSQL's WAL guarantees strict database-level atomicity. Partial database commits cannot occur; either both `Session` and `AuditLog` are committed, or both are aborted.
- **Commit Acknowledgment Loss (Two Generals Problem):** If the network connection breaks after PostgreSQL commits the transaction but before the acknowledgment packet reaches Node.js, the application receives a transport error (`P1001`/`ECONNRESET`). The application cannot know whether the commit succeeded and returns `500 Internal Server Error`.
- **Consequence of Client Retry:** If the client retries login after an ambiguous failure, and the prior transaction actually committed, the retry creates a *second* valid session and a *second* `LOGIN_SUCCESS` audit event. Both sessions co-exist in the database as valid until expiration or explicit revocation.
- **Disclaimers:** Login retries are **not exactly-once** and **not unconditionally safe**. Atomicity guarantees all-or-nothing execution per transaction; it does not guarantee request-level idempotency. No idempotency keys are supported in this phase.

### 2. Dedicated Logout Resolver & Cookie Clearance
The `/api/auth/logout` route replaces standard `authenticate` middleware with a dedicated logout token resolver. The operational lifecycle across all four token states is defined below:

| Case | Token State in Cookie | CSRF Validation | Authentication & Database Mutation | Cookie Header Emitted | Audit Event Recorded | HTTP Response Code & Body |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Missing Cookie** | No `bb_session` cookie present | Pass (No cookie to protect) | **Unauthenticated**. No DB query, no state mutation. | **None** (No cookie was sent to clear). | **None**. | **`401 Unauthorized`**<br>`errorResponse('Authentication required', null, 'UNAUTHORIZED')` |
| **2. Malformed or Unknown Token** | Malformed token string OR valid format not found in `Session` table | **Pass** (Origin strictly validated) | **Unauthenticated**. Never attach session. Never mutate database. Never revoke a session. | **`clearSessionCookie(res)`**<br>(Expired `Set-Cookie` header emitted to purge bad cookie) | **`SESSION_VALIDATION_FAILED`**<br>(Standalone security rejection write). Never `USER_LOGGED_OUT`. | **`401 Unauthorized`**<br>`errorResponse('Session is invalid or not found', null, 'SESSION_INVALID')` |
| **3. Already-Revoked Session** | Valid token found in `Session`, but `revokedAt !== null` (Retry / Race) | **Pass** (Origin strictly validated) | **Unauthenticated**. No database state modified. | **`clearSessionCookie(res)`**<br>(Expired `Set-Cookie` header emitted to free client jar) | **None**.<br>(Skip duplicate `USER_LOGGED_OUT` and duplicate rejection events). | **`200 OK`**<br>`successResponse(null, 'Logged out successfully')` |
| **4. Active Session** | Valid token found in `Session`, and `revokedAt === null` | **Pass** (Origin strictly validated) | **Authenticated**. Atomic transaction executes conditional `updateMany` (`revokedAt = NOW()`). | **`clearSessionCookie(res)`**<br>(Emitted **strictly after** transaction commits) | **`USER_LOGGED_OUT`**<br>(Committed in shared transaction). | **`200 OK`**<br>`successResponse(null, 'Logged out successfully')` |

**Security Boundary Invariants:**
- Mandatory CSRF protection (`csrfProtection`) runs ahead of the dedicated logout resolver on all cookie-bearing requests.
- Unrelated protected business routes (`/api/platform/*`, `/api/owner/*`, `/api/auth/me`) continue to mount standard `authenticate` middleware, strictly rejecting unauthenticated requests without modifying cookies or session state.

### 3. Concurrent Revocations via Conditional Updates
- **Conditional Update Primitive:** Session revocation MUST execute via an atomic conditional update:
  ```javascript
  const result = await tx.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  ```
- **Audit Gating & Concurrency Resolution:**
  ```javascript
  if (result.count === 1) {
    await recordAuditEvent({ tx, action: AUDIT_ACTIONS.USER_LOGGED_OUT, ... });
  }
  ```
- **Concurrent Logout Race Outcome:** If Request A and Request B race to revoke the same session:
  - Under PostgreSQL default `READ COMMITTED` isolation, the first transaction acquires the row lock, updates `revokedAt = NOW()`, logs the revocation audit event, and commits.
  - The second transaction evaluates the row recheck, observes `revokedAt IS NOT NULL`, and updates 0 rows (`result.count === 0`).
  - Because `count === 0`, the second transaction skips audit insertion (preventing duplicate events), emits `clearSessionCookie(res)`, and returns `200 OK`.
  - Both callers receive `200 OK` and cleared cookies; the winning operation preserves the single valid audit record (`USER_LOGGED_OUT` or `ADMIN_SESSION_REVOKED`).

---

## Safe Rejection-Audit Failure Policy

When `recordSecurityRejectionAuditSafe()` is invoked for read-only security events:

```javascript
try {
  await recordAuditEvent({ ... });
} catch (auditErr) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[AUDIT_PERSISTENCE_FAILED]', JSON.stringify({
      action: approvedAction,
      failureCategory: 'AUDIT_WRITE_FAILURE',
      requestId: req?.id || null,
      timestamp: new Date().toISOString(),
      errorClass: auditErr.name || 'Error',
      errorCode: auditErr.code || 'DATABASE_WRITE_ERROR',
      diagnosticContext: {
        reason: controlledReason,
        resourceType: controlledResourceType,
      },
    }));
  }
}
// Deterministic rejection is preserved
throw createHttpError(401, 'Invalid credentials');
```

### Strict Field-Level Logging Contract
1. `action`: Approved audit action constant only (e.g. `SUPERADMIN_LOGIN_FAILED`, `OWNER_LOGIN_FAILED`, `SESSION_VALIDATION_FAILED`, `CSRF_VALIDATION_FAILED`).
2. `failureCategory`: Fixed literal `'AUDIT_WRITE_FAILURE'`.
3. `requestId`: Validated string correlation ID or `null`.
4. `timestamp`: Server ISO-8601 timestamp (`new Date().toISOString()`).
5. `errorClass`: Safe constructor name (e.g. `'PrismaClientKnownRequestError'`, `'Error'`).
6. `errorCode`: Safe database/ORM code (e.g. `'P2002'`, `'23505'`) or fallback `'DATABASE_WRITE_ERROR'`.
7. `diagnosticContext.reason`: Controlled classification code only (e.g. `'INVALID_CREDENTIALS'`, `'SESSION_REVOKED'`, `'CSRF_INVALID_ORIGIN'`, `'SESSION_NOT_FOUND'`).
8. `diagnosticContext.resourceType`: Controlled classification string (e.g. `'SESSION'`, `'USER'`, `'TENANT'`) or `null`.

**Prohibitions:** Raw event metadata, stack traces, error messages, request/response objects, passwords, password hashes, raw tokens, cookies, authorization headers, recovery codes, secrets, and unmasked personal identifiers are strictly prohibited from log output.
