# BillingBuddy — WP-SUB-02: Security & Offline Entitlements Specification
## Cryptographic Leases, Android Keystore Identity, Anti-Tampering, and Privileged Audit

- **Document Identifier:** `WP-SUB-02-SEC`
- **Module ID:** `SUB-ENTITLEMENTS-01`
- **Version:** `1.2.0` (Updated: Resolves Clarification A — Android Offline Security)
- **Status:** `READY_FOR_FINAL_OWNER_REVIEW`
- **Target Repository:** `BillingBuddy` (`E:\Projects\BillPOS`)
- **Execution Mode:** Documentation and Architecture Design Only

---

## 1. Executive Summary & Security Objectives

This document establishes the end-to-end security architecture, offline cryptographic leasing protocol, Android hardware-backed device identity, local anti-tampering engine, and privileged Superadmin audit framework for BillingBuddy's **Subscription & Entitlements** module.

### Core Security Invariants:
1. **Zero Offline Self-Extension (Mandatory Invariant):** An offline POS device can **never** extend its authorization beyond the server-issued expiration timestamp (`exp`). The maximum lease validity is strictly 72 hours from the server's `issuedAt` timestamp:
   $$\text{exp} \le \min(\text{issuedAt} + 72 \text{ hours}, \text{subscription.currentPeriodEnd})$$
2. **Hardware-Backed Device Identity (Android Keystore):** Devices generate an asymmetric key pair inside the hardware-backed Android Keystore (Secure Element / TEE). Leases are cryptographically locked to the device's registered public key. Hardware fingerprint hashes (MAC, build serial) serve only as supplementary telemetry, never as the sole identity barrier.
3. **Multi-Signal Anti-Tampering:** Offline elapsed time is tracked using Android's monotonic `SystemClock.elapsedRealtime()` combined with an encrypted high-watermark ledger. Any backward clock adjustment or reboot discrepancy locks the client into `TAMPER_LOCKED` state.
4. **Privileged Mutation Gating (D-08):** All Superadmin overrides, plan modifications, and payment verifications require step-up multi-factor authentication (TOTP), row-level database locks, and structured immutable audit records.

---

## 2. Android Hardware-Backed Device Identity & Registration

### 2.1 The Vulnerability of Pure Hardware Fingerprints
On modern Android (Android 10+), MAC addresses are randomized per network, hardware serial numbers (`Build.SERIAL`) are restricted, and IMEI/Android ID can be spoofed on rooted devices. Relying solely on a hardware fingerprint hash allows attackers to clone or replay tokens onto unauthorized hardware.

### 2.2 Android Keystore Asymmetric Binding
BillingBuddy establishes device identity through hardware-backed public-key cryptography:

```
[Android POS Client]                                             [Cloud Backend API]
        |                                                                 |
 1. Generate EC / Ed25519 KeyPair                                         |
    in Android Keystore (TEE / StrongBox)                                 |
    Alias: "bb_pos_device_identity"                                       |
    (Private key never leaves hardware)                                   |
        |                                                                 |
 2. Device Pairing Request                                                |
    POST /api/v1/pos/devices/pair                                         |
    Payload: { outletId, deviceName, devicePublicKeyPem, clientTelemetry }|
        |---------------------------------------------------------------->|
        |                                                                 | 3. Validate Store Owner JWT
        |                                                                 |    Assert outlet quota
        |                                                                 |    Create PosDevice row
        |                                                                 |    Store devicePublicKeyPem
        |                                                                 |    Compute publicKeyThumbprint
        |                                                                 |    Generate initial Lease
        | 4. Return Device Credentials & Ed25519 Signed Lease             |
        |<----------------------------------------------------------------|
```

### 2.3 Device Replacement and Re-registration Workflow
When a POS tablet is damaged, replaced, or decommissioned:
1. **De-registration:** The Store Owner or Superadmin initiates de-registration via `POST /api/v1/owner/devices/:id/revoke`. The existing device's status is set to `REVOKED` and its active lease token version is invalidated.
2. **Quota Slot Freed:** Releasing the device decrements active device count, freeing a slot within `max_devices`.
3. **New Device Onboarding:** The replacement device generates its own unique keypair inside its Android Keystore and registers via the pairing ceremony.
4. **Stolen / Compromised Device Defense:** A revoked device operating offline remains restricted to its existing lease window (at most 72 hours). The moment it connects to the internet, it receives `403 FORBIDDEN: DEVICE_REVOKED` and purges all local cached data.

---

## 3. Cryptographic Lease Specification (Decision D-07)

### 3.1 Exact Signed Lease Payload Schema
The cloud server issues an Ed25519-signed lease formatted as a compact base64url JSON token:

```json
{
  "header": {
    "alg": "EdDSA",
    "typ": "BBUDDY-LEASE",
    "kid": "bb-lease-2026-v1"
  },
  "payload": {
    "iss": "https://api.billingbuddy.in",
    "sub": "550e8400-e29b-41d4-a716-446655440000",
    "aud": "pos-device-uuid-9876",
    "iat": 1794240000,
    "exp": 1794499200,
    "leaseVersion": 4,
    "deviceKeyThumbprint": "SHA256:7b5d1a2c3f4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "tenant": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "ACTIVE"
    },
    "plan": {
      "code": "GROWTH",
      "status": "ACTIVE"
    },
    "entitlements": {
      "offline_pos": true,
      "max_products": 5000,
      "max_daily_offline_orders": 500
    },
    "security": {
      "serverIssuedAt": "2026-11-09T16:00:00.000Z",
      "maxLifetimeSeconds": 259200
    }
  }
}
```

### 3.2 Field Definitions & Enforcement Rules

| Field | Description | Client Enforcement Rule |
|---|---|---|
| `iss` | Issuer URL | Must match authoritative BillingBuddy API domain. |
| `sub` | Tenant ID | Must match currently configured tenant in local storage. Prevents cross-tenant token sharing. |
| `aud` | Device ID | Must match registered local device UUID (`posDeviceId`). |
| `iat` | Issued At (Unix timestamp) | Baseline server timestamp for the lease. |
| `exp` | Expiration (Unix timestamp) | **Absolute cut-off.** Strict rule: $\text{exp} \le \min(\text{iat} + 72\text{h}, \text{periodEnd})$. |
| `leaseVersion` | Monotonic lease version | Client rejects any lease with `leaseVersion < currentStoredVersion`. |
| `deviceKeyThumbprint` | SHA-256 of device public key | Client verifies this matches the hash of its Android Keystore public key. |
| `kid` | Server Key Identifier | Directs client to the correct server public key in its trusted key ring. |

---

## 4. Clock and Persistence Protection Architecture

### 4.1 Why SQLite Timestamps Alone Are Insufficient
On rooted Android devices or following malicious system clock adjustments:
- The system wall clock (`System.currentTimeMillis()`) can be wound backward arbitrarily.
- A user can restore an old SQLite backup file where timestamps were earlier.
- A user can clear application storage or reinstall the application.

### 4.2 Multi-Signal High-Watermark Protocol
To defeat clock manipulation across reboots, app restarts, and offline periods, the BillingBuddy POS client combines four distinct temporal and persistence signals:

```
[Android OS Hardware]                                [Secure Local Storage]
         |                                                      |
 1. SystemClock.elapsedRealtime()                               |
    (Monotonic hardware timer,                                  |
     includes deep sleep, immune to clock changes)              |
         |                                                      |
 2. Settings.Global.BOOT_COUNT                                  |
    (Monotonic integer incremented on every reboot)             |
         |                                                      |
         +----------------------------------------------------->+
                                                                |
                                                    3. Encrypted Watermark Ledger:
                                                       - lastServerSyncWallClock
                                                       - elapsedRealtimeAtSync
                                                       - bootCountAtSync
                                                       - highWatermarkWallClock
                                                       - transactionCounter
```

#### A. In-Session Monotonic Verification:
During active runtime, time elapsed since sync is measured via:
$$\text{calculatedCurrentTime} = \text{lastServerSyncWallClock} + (\text{elapsedRealtime}() - \text{elapsedRealtimeAtSync})$$
This calculation is **completely immune to user system clock changes**. Even if the user alters Android's date/time in system settings, `elapsedRealtime()` continues incrementing accurately.

#### B. Reboot & Boot-Count Detection:
When an Android device reboots, `elapsedRealtime()` resets to zero, but `BOOT_COUNT` increments:
1. Client detects `currentBootCount > bootCountAtSync`.
2. Client checks `currentWallClock >= highWatermarkWallClock - 60s`.
3. If `currentWallClock < highWatermarkWallClock - 60s`:
   - **TAMPER DETECTED:** Device entered past time after reboot. Client immediately sets `isTamperLocked = true`.

#### C. Database Deletion & Application Reinstall:
If application data is cleared or the database is deleted:
- The Android Keystore key alias is either wiped or orphaned.
- The stored offline lease is destroyed.
- **Fail-Closed Invariant:** The client has zero valid lease tokens. The POS cannot operate offline without connecting to the server to re-authenticate and download a new lease.

#### D. Trustworthy Time Unavailable:
If both monotonic elapsed time and server time are unavailable:
- The client adopts **Default Deny**: POS checkout is disabled.

---

## 5. `TAMPER_LOCKED` State & Recovery Workflow

```
[POS Enters TAMPER_LOCKED State]
               |
               |-- Disable POS Checkout button
               |-- Display persistent Red Warning Modal:
               |   "Device security locked due to system time discrepancy.
               |    Internet connection required to verify subscription."
               |-- Allow viewing open orders / local receipt history
               |-- Protect local offline transaction queue in SQLite
               |
               v
[Store Connects Device to Internet]
               |
 1. Send Recovery Ping: POST /api/v1/pos/lease/recover
    Payload: { deviceId, localTamperTimestamp, clientClock, queueCount }
               |
               v
 2. Server Validates:
    - Authoritative NTP Server Time
    - Tenant Subscription Status (TRIAL / ACTIVE / GRACE_PERIOD)
    - Device Active Status in Database
               |
               v
 3. Server Response:
    - If Subscription Valid: Issues Fresh Ed25519 Lease (72h validity)
    - Server clears tamper flag
               |
               v
 4. Client Synchronizes Local Queue:
    - Locally queued offline transactions are uploaded to /api/v1/pos/orders/sync
    - Queued transactions retain their original local creation timestamps
    - Client updates highWatermarkWallClock = serverResponseTime
    - Client unlocks POS checkout
```

### 5.1 Fate of Locally Queued Transactions
Transactions completed offline *prior* to entering `TAMPER_LOCKED` are not lost. They are securely held in the local SQLite append-only log. During the online recovery handshake, these transactions are synced to the cloud backend and reconciled into accounting records.

---

## 6. Superadmin Privileged Mutation Security (Decision D-08)

All operations altering tenant subscriptions, quotas, or billing statuses are classified as **Class A Platform Mutations**:
1. **TOTP Step-Up Verification:** Executed via `assertPrivilegedMutationAuthorized(adminId, totpCode, tx)` which locks the `UserTotp` record for the Superadmin and validates the 6-digit code.
2. **Pessimistic Locking:** Locks the target tenant's `TenantSubscription` row to serialize concurrent administrative actions.
3. **Structured Audit Trail:** Emits records to `AuditLog` containing `{ before, after, reason, authorId, ipAddress }` using `AUDIT_MODULES.BILLING`.
