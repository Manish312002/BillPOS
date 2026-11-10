# BillingBuddy — WP-SUB-02: Acceptance Test Matrix
## Comprehensive Verification Scenarios & Test Suite Specifications

- **Document Identifier:** `WP-SUB-02-TEST-MATRIX`
- **Module ID:** `SUB-ENTITLEMENTS-01`
- **Version:** `1.2.0` (Updated: Resolves Clarifications A, B, and C)
- **Status:** `READY_FOR_FINAL_OWNER_REVIEW`
- **Target Repository:** `BillingBuddy` (`E:\Projects\BillPOS`)
- **Execution Mode:** Documentation and Architecture Design Only

---

## 1. Executive Summary & Verification Strategy

This test matrix specifies the complete set of automated and manual test scenarios validating BillingBuddy's **Subscription & Entitlements** module, incorporating Android Keystore device identity, decimal integer string API serialization, the 11 lifecycle coordination scenarios, and anti-tamper recovery workflows.

---

## 2. Test Suite Matrix by Domain

### Domain 1: Android Hardware-Backed Identity & Offline Leases (Clarification A & Decision D-07)

| Test ID | Description | Preconditions | Execution Steps | Expected Result | Test Type |
|---|---|---|---|---|---|
| `TC-DEV-01` | Pairing device with Android Keystore public key | Tenant active; outlet created. | Send `POST /api/v1/pos/devices/pair` with `devicePublicKeyPem`. | `PosDevice` created with `publicKeyThumbprint`; initial 72h Ed25519 lease returned. | Integration |
| `TC-DEV-02` | Device replacement workflow | Device A registered. Tenant at max devices limit (2/2). | 1. Revoke Device A via `POST /owner/devices/:id/revoke`.<br>2. Pair Device B. | Device A marked `REVOKED`; quota decremented to 1/2; Device B pairs successfully (`201 Created`). | Integration |
| `TC-LEASE-01` | Ed25519 signature validity | Backend signs lease with server private key. | POS verifies using embedded server public key and matching `kid`. | Signature verifies cryptographically; payload validated. | Unit / Crypto |
| `TC-LEASE-02` | Server-issued 72-hour lifetime ceiling | Server issues lease. | Inspect `iat` and `exp`. | Strict assertion: `exp - iat <= 259200` seconds. Zero offline self-extension allowed. | Unit / Security |
| `TC-CLOCK-01` | Detection of backward clock rollback | Device has high-watermark timestamp $T$. | Set Android system time backward ($T - 7200\text{s}$) and attempt checkout. | Monotonic timer / watermark detects discrepancy; sets `isTamperLocked = true`; checkout disabled (`CLOCK_ROLLBACK_DETECTED`). | Security / E2E |
| `TC-RECOV-01` | `TAMPER_LOCKED` recovery workflow | Device in `TAMPER_LOCKED` state with 3 queued local orders. | Connect device to internet; call `POST /api/v1/pos/lease/recover`. | Server verifies NTP time & tenant status; returns fresh lease; tamper flag cleared; 3 local orders synced without data loss. | E2E / Integration |

---

### Domain 2: Decimal Integer String Serialization & Math (Clarification B)

| Test ID | Description | Preconditions | Execution Steps | Expected Result | Test Type |
|---|---|---|---|---|---|
| `TC-SER-01` | Canonical decimal integer string serialization | `PlanPrice` has `amountPaise = 99900n`. | Query `GET /api/v1/platform/plans`. | Express safely returns `"amountPaise": "99900"` and `"amountFormatted": "₹999.00"`. Zero floats. | Unit / Integration |
| `TC-SER-02` | Zod validation rejects decimal float numbers | User submits JSON with float rupees. | Submit `{ "amountPaise": 999.50 }` to payment API. | Zod schema rejects input (expected decimal integer string). | Unit |
| `TC-SER-03` | Zod validation accepts valid integer strings | User submits valid string. | Submit `{ "amountPaise": "99900" }`. | Zod validates successfully; transforms to native `BigInt(99900)`. | Unit |
| `TC-SER-04` | Overflow rejection beyond 1 trillion paise | User submits string $> 10^{14}$ paise. | Submit extreme integer string. | Zod schema rejects input as out of allowable financial range. | Unit |

---

### Domain 3: Eleven Lifecycle Coordination Scenarios (Clarification C)

| Test ID | Description | Preconditions | Execution Steps | Expected Result | Test Type |
|---|---|---|---|---|---|
| `TC-LIFE-01` | Scenario 1: Payment submitted but unverified | Unpaid invoice exists. | Store Owner submits UTR. | `SubscriptionPayment` created (`PENDING`); `TenantSubscription` status **UNCHANGED**. Zero automatic activation. | Integration |
| `TC-LIFE-02` | Scenario 2: Payment rejected by Superadmin | Payment `PENDING`. | Superadmin rejects UTR with reason. | Payment marked `REJECTED`; subscription status untouched; lifecycle clock continues. | Integration |
| `TC-LIFE-03` | Scenario 3: Payment verified successfully | Payment `PENDING`. | Superadmin verifies UTR with TOTP. | Payment `VERIFIED`; invoice `PAID`; subscription transitions to `ACTIVE` (or period extended). | Integration |
| `TC-LIFE-04` | Scenario 4: Early renewal payment submitted | Subscription `ACTIVE`. | Owner submits renewal payment before expiry. | Payment created (`PENDING`); subscription remains `ACTIVE`; access continues uninterrupted. | Integration |
| `TC-LIFE-05` | Scenario 5: Renewal pending in grace period | Subscription in `GRACE_PERIOD`. | Owner submits renewal UTR. | Payment created (`PENDING`); subscription remains `GRACE_PERIOD`; POS billing continues with banner. | Integration |
| `TC-LIFE-06` | Scenario 6: Renewal rejected in grace period | Payment `PENDING` during grace. | Superadmin rejects UTR. | Payment marked `REJECTED`; subscription remains `GRACE_PERIOD`. When grace ends, cron moves tenant to `READ_ONLY`. | Integration |
| `TC-LIFE-07` | Scenario 7: Manual period extension | Active subscription. | Superadmin extends period by 14 days with TOTP. | `currentPeriodEnd` advanced by 14 days; zero payment records created; audit record emitted. | Security / Integration |
| `TC-LIFE-08` | Scenario 8: Tenant suspended independently | Active paid subscription. | Superadmin suspends tenant (`Tenant.status = 'SUSPENDED'`). | All API access blocked at gateway (`403 TENANT_SUSPENDED`); subscription payment records preserved untouched. | Security |
| `TC-LIFE-09` | Scenario 9: Tenant reinstated after suspension | Tenant `SUSPENDED`. | Superadmin reinstates tenant. | Tenant access restored; subscription evaluated dynamically based on period dates. | Security / Integration |
| `TC-LIFE-10` | Scenario 10: Cancellation at period end | Active subscription. | Owner schedules cancellation. | `cancelAtPeriodEnd = true`; full access continues until `currentPeriodEnd`, after which cron marks `CANCELED`. | Integration |
| `TC-LIFE-11` | Scenario 11: Subscription reactivated after cancellation | Subscription `CANCELED`. | Store Owner subscribes to new plan. | New `TenantSubscription` row created with `ACTIVE` status (allowed by partial unique index); past canceled row preserved. | Integration / DB |

---

### Domain 4: Quota Concurrency & Read-Only Gating (Findings 4 & 6)

| Test ID | Description | Preconditions | Execution Steps | Expected Result | Test Type |
|---|---|---|---|---|---|
| `TC-CONC-01` | 5 concurrent outlet creations with 1 slot remaining | Tenant on 1-outlet plan has 0 outlets. | Fire 5 concurrent `POST /api/v1/outlets`. | Pessimistic row lock serializes requests: exactly 1 succeeds; 4 fail with `403 QUOTA_EXCEEDED`. Total DB outlets = 1. | Concurrency |
| `TC-RO-01` | Read-only mode allows receipt viewing & UTR submit | Tenant in `READ_ONLY` mode. | 1. Call `GET /api/v1/pos/orders`.<br>2. Call `POST /owner/subscription/payments/submit-utr`. | Both succeed (`200 OK` and `201 Created`). | Integration |
| `TC-RO-02` | Read-only mode blocks POS checkout | Tenant in `READ_ONLY` mode. | Call `POST /api/v1/pos/orders`. | Hard rejection: `403 FORBIDDEN: SUBSCRIPTION_READ_ONLY`. Zero DB mutations. | Integration / E2E |
