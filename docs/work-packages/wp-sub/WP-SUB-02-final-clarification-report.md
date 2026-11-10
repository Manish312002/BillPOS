# BillingBuddy — WP-SUB-02: Final Clarification & Specification Freeze Report
## Architectural Clarifications on Android Offline Security, BigInt Serialization, and Lifecycle Coordination

- **Document Identifier:** `WP-SUB-02-FINAL-CLARIFICATION`
- **Module ID:** `SUB-ENTITLEMENTS-01`
- **Version:** `1.0.0`
- **Status:** `READY_FOR_FINAL_OWNER_REVIEW`
- **Execution Mode:** Documentation and Architecture Review Only
- **Target Repository:** `BillingBuddy` (`E:\Projects\BillPOS`)

---

## 1. Executive Summary

This report delivers the final technical clarifications and formal design decisions for BillingBuddy's **Subscription & Entitlements** module, focusing on three critical architectural domains:
1. **Android Offline Entitlement Lease Security (Clarification A):** Hardware-backed device identity via Android Keystore, multi-signal monotonic anti-tampering, and `TAMPER_LOCKED` recovery workflows.
2. **BigInt Financial API Serialization (Clarification B):** Four-tier representation framework with canonical decimal integer strings to eliminate IEEE 754 precision loss.
3. **Subscription & Payment Lifecycle Coordination (Clarification C):** Exhaustive specification of the eleven canonical operational scenarios coordinating `Tenant.status`, `TenantSubscription.status`, and `SubscriptionPayment.status`.

All nine approved business decisions (`D-01` through `D-09`) remain immutable. Zero application source code, schema migrations, or test files were modified.

---

## 2. Technical Clarification Details & Chosen Designs

### Clarification A: Android Offline Entitlement Lease Security

#### 1. Original Concern:
Hardware fingerprint hashes (MAC address, build serial) can be spoofed or randomized on Android 10+ devices, risking lease cloning. Furthermore, relying solely on SQLite timestamps does not prevent clock rollback across device reboots or application reinstalls.

#### 2. Technical Clarification & Chosen Design:
- **Android Keystore Hardware Identity:** During device pairing, the POS client generates an asymmetric key pair inside the hardware-backed Android Keystore (TEE / StrongBox). The private key never leaves the secure hardware. The device public key (`devicePublicKeyPem`) is registered in the database, and its SHA-256 fingerprint (`deviceKeyThumbprint`) is embedded inside the Ed25519-signed lease payload. Hardware fingerprints serve only as supplementary signals.
- **Lease Payload Invariant:** The lease is signed by the cloud backend using Ed25519. An offline client cannot self-extend or modify `exp`. The maximum lease validity is strictly 72 hours from server issuance:
  $$\text{exp} \le \min(\text{issuedAt} + 72\text{ hours}, \text{subscription.currentPeriodEnd})$$
- **Multi-Signal Anti-Tampering Engine:** To defeat clock manipulation, the client combines:
  1. `SystemClock.elapsedRealtime()`: Monotonic hardware timer including deep sleep (immune to system time changes).
  2. `Settings.Global.BOOT_COUNT`: Monotonic integer incremented on reboot to detect power cycles.
  3. Persistent Encrypted Watermark Ledger: Tracks `lastServerSyncWallClock`, `elapsedRealtimeAtSync`, and `highWatermarkWallClock`.
- **Fail-Closed Persistence Invariant:** Clearing application data or deleting the local database destroys the Keystore alias and stored lease, forcing the client to authenticate online before operating.
- **`TAMPER_LOCKED` Recovery Workflow:** When clock rollback is detected ($>60\text{s}$), checkout is locked. Offline orders queued *prior* to lock remain protected in local SQLite. Recovery requires calling `POST /api/v1/pos/lease/recover`, where the server validates NTP time, clears the tamper state, issues a fresh lease, and syncs queued transactions without data loss.

#### 3. Affected Documents:
- `WP-SUB-02-security-and-offline-entitlements.md` (Sections 1 through 5)
- `WP-SUB-02-database-design.md` (Section 3, 8)
- `WP-SUB-02-api-contracts.md` (Section 3)
- `WP-SUB-02-acceptance-test-matrix.md` (Domain 1: `TC-DEV-01`, `TC-DEV-02`, `TC-CLOCK-01`, `TC-RECOV-01`)
- `WP-SUB-02-architecture.md` (Section 1, 2)
- `WP-SUB-02-implementation-roadmap.md` (Slice 8)

---

### Clarification B: BigInt Financial API Serialization

#### 1. Original Concern:
Directly returning JavaScript `Number` or floating-point figures for financial amounts risks IEEE 754 precision loss and JSON serialization exceptions with native `BigInt`.

#### 2. Technical Clarification & Chosen Design:
Established an unambiguous **Four-Tier Financial Architecture**:
- **Tier 1 (Database Persistence):** Stored as 64-bit integer paise in PostgreSQL `BIGINT`, mapped to Prisma `BigInt` (`99900n`).
- **Tier 2 (Application Calculation):** Native JavaScript `BigInt` arithmetic via `@billingbuddy/shared/src/utils/currency.js`. Zero floating-point operations.
- **Tier 3 (External API Wire Representation):** Canonical **decimal integer strings** (e.g., `"amountPaise": "99900"`).
- **Tier 4 (Human-Readable UI Presentation):** Localized formatted currency strings (e.g., `"amountFormatted": "₹999.00"`).

Zod API validation enforces:
```javascript
z.string().regex(/^\d+$/, 'Must be a decimal integer string representing paise')
```
Explicit API DTO serializer functions (e.g. `toPlanPriceDto()`, `toSubscriptionInvoiceDto()`) convert Prisma BigInt fields to decimal integer strings and localized currency strings at controller boundaries, eliminating global prototype mutations.

#### 3. Affected Documents:
- `WP-SUB-02-database-design.md` (Section 1, 4)
- `WP-SUB-02-technical-specification.md` (Section 3)
- `WP-SUB-02-api-contracts.md` (Section 1, 2, 4)
- `WP-SUB-02-acceptance-test-matrix.md` (Domain 2: `TC-SER-01` through `TC-SER-04`)
- `WP-SUB-02-architecture.md` (Section 2)
- `WP-SUB-02-implementation-roadmap.md` (Slice 2)

---

### Clarification C: Subscription and Payment Lifecycle Coordination

#### 1. Original Concern:
Coordination between tenant platform compliance (`Tenant.status`), commercial entitlement state (`TenantSubscription.status`), and financial payments (`SubscriptionPayment.status`) required explicit operational rules for all eleven edge scenarios.

#### 2. Technical Clarification & Chosen Design:
- **Core Decoupling Invariant:** Submitting a payment reference (UTR) creates a `SubscriptionPayment` row in `PENDING` status; it **never** automatically activates or extends a subscription.
- **Only Verified Payment or Authorized Superadmin Action:** Can transition subscriptions to `ACTIVE` or advance `currentPeriodEnd`.
- **Tenant Suspension Independence:** Setting `Tenant.status = 'SUSPENDED'` blocks all user access at the authentication gate immediately, but does not modify, corrupt, or rewrite subscription records or payment history.
- **Cancellation at Period End:** Sets `cancelAtPeriodEnd = true`, preserving access until term conclusion, at which point background cron marks the subscription `CANCELED`.
- **Reactivation Support:** When a tenant resubscribes after cancellation, the canceled row is preserved and a **new** `TenantSubscription` row is inserted (guaranteed by the PostgreSQL partial unique index).

#### 3. Affected Documents:
- `WP-SUB-02-technical-specification.md` (Section 1, 2)
- `WP-SUB-02-database-design.md` (Section 2, 3, 5)
- `WP-SUB-02-acceptance-test-matrix.md` (Domain 3: `TC-LIFE-01` through `TC-LIFE-11`)
- `WP-SUB-02-architecture.md` (Section 2)
- `WP-SUB-02-implementation-roadmap.md` (Slice 3)

---

## 3. Revised Acceptance Tests & Security Test Cases

The test matrix was expanded to validate all clarified workflows:
- `TC-DEV-01`: Android Keystore device pairing with public key thumbprint.
- `TC-DEV-02`: Device replacement workflow and quota recycling.
- `TC-CLOCK-01`: Multi-signal monotonic rollback detection.
- `TC-RECOV-01`: `TAMPER_LOCKED` recovery with zero data loss for queued offline orders.
- `TC-SER-01` to `TC-SER-04`: Decimal integer string serialization and float rejection.
- `TC-LIFE-01` to `TC-LIFE-11`: Exhaustive coverage of all eleven lifecycle coordination scenarios.

---

## 4. Remaining System Limitations

1. **Air-Gapped Revocation Window:** If a device is permanently disconnected from the internet, a mid-period administrative revocation cannot reach it over the air. However, the exposure window is strictly bounded to the remaining lease duration (at most 72 hours from server issuance).
2. **Phase 1 Payment Scope:** In strict compliance with Decision D-09, zero payment gateways are integrated in Phase 1. Reconciliation relies entirely on Superadmin manual verification of bank UTR references.

---

## 5. Specification Readiness Assessment

The specification package under `docs/work-packages/wp-sub/` is **frozen, complete, technically reconciled, and ready for final project-owner review**.
