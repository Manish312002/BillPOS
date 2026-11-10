# BillingBuddy — WP-SUB-02: API Contracts Specification
## Subscription & Entitlements Functional Module

- **Document Identifier:** `WP-SUB-02-API`
- **Module ID:** `SUB-ENTITLEMENTS-01`
- **Version:** `1.2.0` (Updated: Resolves Clarification B — Decimal Integer Strings)
- **Status:** `READY_FOR_FINAL_OWNER_REVIEW`
- **Target Repository:** `BillingBuddy` (`E:\Projects\BillPOS`)
- **Execution Mode:** Documentation and Architecture Design Only

---

## 1. Executive Summary & Serialization Standards (Clarification B)

This document specifies the complete REST API contract for BillingBuddy's **Subscription & Entitlements** module.

### Core Data & Serialization Standards:
1. **Decimal Integer String Standard (Clarification B):**
   - Monetary values in paise are transmitted over JSON as **decimal integer strings**:
     ```json
     {
       "amountPaise": "99900",
       "amountFormatted": "₹999.00"
     }
     ```
   - Eliminates IEEE 754 precision loss across all clients (JavaScript, Python, Dart/Flutter, Java).
   - Floating-point representations (`999.00` as a raw JSON number) are strictly forbidden.
2. **Android Keystore Device Pairing (Clarification A):**
   - POS device pairing transmits the hardware-backed public key (`devicePublicKeyPem`).
3. **Privileged Superadmin Security (D-08):**
   - Mutating administrative requests require an `x-totp-code` header or payload and a minimum 10-character `reason` string.

---

## 2. Superadmin API Endpoints (`/api/v1/platform`)

### 2.1 List All Plans

- **Endpoint:** `GET /api/v1/platform/plans`
- **Auth:** Bearer Token, Role: `SUPERADMIN`
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "c8b4f17a-8f23-4412-9c98-1123456789ab",
      "code": "STARTER",
      "name": "Starter Tier",
      "description": "Ideal for single-outlet retail shops",
      "isActive": true,
      "isPublic": true,
      "version": 1,
      "prices": [
        {
          "id": "price-starter-monthly",
          "billingCycle": "MONTHLY",
          "currency": "INR",
          "amountPaise": "99900",
          "amountFormatted": "₹999.00"
        },
        {
          "id": "price-starter-annual",
          "billingCycle": "ANNUAL",
          "currency": "INR",
          "amountPaise": "999000",
          "amountFormatted": "₹9,990.00"
        }
      ],
      "features": {
        "max_outlets": 1,
        "max_users": 2,
        "max_devices": 2,
        "max_products": 500,
        "offline_pos": true,
        "advanced_reports": false
      }
    }
  ]
}
```

---

### 2.2 Create / Update Plan Version

- **Endpoint:** `POST /api/v1/platform/plans`
- **Auth:** Bearer Token, Role: `SUPERADMIN`, Class A Mutation
- **Headers:** `x-totp-code: 123456`
- **Zod Request Schema:**
```javascript
export const createPlanSchema = z.object({
  code: z.string().min(3).max(32).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(3).max(64),
  description: z.string().max(256).optional(),
  trialDays: z.number().int().min(0).default(0),
  isPublic: z.boolean().default(true),
  prices: z.array(z.object({
    billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
    amountPaise: z.string().regex(/^\d+$/, 'Must be a decimal integer string representing paise')
  })).min(1),
  features: z.record(z.string(), z.union([z.boolean(), z.number().int()])),
  reason: z.string().min(10, 'Mandatory audit justification required')
});
```

---

### 2.3 Verify Manual Payment & Activate Subscription (Decision D-09)

- **Endpoint:** `POST /api/v1/platform/payments/:id/verify`
- **Auth:** Bearer Token, Role: `SUPERADMIN`, Class A Mutation
- **Headers:** `x-totp-code: 123456`
- **Zod Request Schema:**
```javascript
export const verifyPaymentSchema = z.object({
  receivedPaise: z.string().regex(/^\d+$/, 'Must be a decimal integer string representing paise'),
  bankTransactionDate: z.string().datetime(),
  reason: z.string().min(10)
});
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "paymentId": "pay-99887766",
    "referenceNumber": "SBI123456789012",
    "status": "VERIFIED",
    "amountPaise": "99900",
    "amountFormatted": "₹999.00",
    "verifiedAt": "2026-11-09T16:15:00.000Z",
    "subscription": {
      "status": "ACTIVE",
      "currentPeriodEnd": "2027-11-09T16:15:00.000Z"
    }
  }
}
```

---

## 3. POS Device Pairing & Lease Issuance (Clarification A)

### 3.1 Register / Pair POS Device with Android Keystore Public Key

- **Endpoint:** `POST /api/v1/pos/devices/pair`
- **Auth:** Bearer Token, Role: `STORE_OWNER`
- **Zod Request Schema:**
```javascript
export const pairPosDeviceSchema = z.object({
  outletId: z.string().uuid(),
  deviceName: z.string().min(2).max(64),
  devicePublicKeyPem: z.string().min(64, 'Valid PEM encoded public key from Android Keystore'),
  clientTelemetry: z.object({
    androidVersion: z.string(),
    appVersion: z.string(),
    deviceModel: z.string()
  }).optional()
});
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "deviceId": "pos-device-uuid-9876",
    "outletId": "out-mumbai-01",
    "publicKeyThumbprint": "SHA256:7b5d1a2c3f4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "initialLease": "eyJhbGciOiJFZERTQSI...<base64url-ed25519-signed-lease>",
    "leaseExpiresAt": "2026-11-12T16:00:00.000Z"
  }
}
```

---

### 3.2 Recovery Ping from `TAMPER_LOCKED` State

- **Endpoint:** `POST /api/v1/pos/lease/recover`
- **Auth:** Bearer Token (or Device Key Signature Challenge)
- **Zod Request Schema:**
```javascript
export const recoverTamperSchema = z.object({
  deviceId: z.string().uuid(),
  localTamperTimestamp: z.string().datetime(),
  clientClock: z.string().datetime(),
  offlineQueueCount: z.number().int().nonnegative()
});
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "serverTime": "2026-11-09T16:35:00.000Z",
    "tamperCleared": true,
    "newLease": "eyJhbGciOiJFZERTQSI...<base64url-fresh-lease>",
    "leaseExpiresAt": "2026-11-12T16:35:00.000Z"
  }
}
```

---

## 4. Store Owner API Endpoints (`/api/v1/owner/subscription`)

### 4.1 Submit Manual Payment UTR (Allowed in Read-Only Mode)

- **Endpoint:** `POST /api/v1/owner/subscription/payments/submit-utr`
- **Auth:** Bearer Token, Role: `STORE_OWNER`
- **Zod Request Schema:**
```javascript
export const submitUtrSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPaise: z.string().regex(/^\d+$/, 'Must be a decimal integer string representing paise'),
  referenceNumber: z.string().min(6).max(32).transform(val => val.trim().toUpperCase()),
  method: z.enum(['UPI', 'BANK_TRANSFER']).default('UPI'),
  proofDocumentUrl: z.string().url().optional(),
  notes: z.string().max(256).optional()
});
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "paymentId": "pay-11223344",
    "referenceNumber": "SBI123456789012",
    "amountPaise": "99900",
    "amountFormatted": "₹999.00",
    "status": "PENDING",
    "submittedAt": "2026-11-09T16:20:00.000Z",
    "message": "Payment submitted successfully. Superadmin will verify within 2-4 hours."
  }
}
```

---

## 5. Error Code Catalog

| Error Code | HTTP Status | Description | Trigger Condition |
|---|---|---|---|
| `QUOTA_EXCEEDED` | `403` | Resource limit reached for plan | Attempting to create outlet/user beyond allowed quota (D-06). |
| `SUBSCRIPTION_READ_ONLY` | `403` | Subscription in read-only state | Mutating API endpoint called when grace period expired (D-04). |
| `SUBSCRIPTION_SUSPENDED` | `403` | Account suspended | Tenant or subscription administratively locked. |
| `DOWNGRADE_VIOLATION` | `422` | Target plan cannot accommodate usage | Downgrading when active usage exceeds target limits (D-05). |
| `DUPLICATE_PAYMENT_REFERENCE` | `409` | UTR already registered | Submitting an existing bank UTR string (D-09). |
| `INVALID_TOTP_CODE` | `401` | Superadmin 2FA failure | Privileged mutation attempted without valid TOTP. |
| `CLOCK_ROLLBACK_DETECTED` | `403` | Local time manipulation | POS local clock wound backward. |
| `TAMPER_LOCKED` | `403` | Offline terminal locked | Device locked due to anti-tamper trigger. |
| `DEVICE_REVOKED` | `403` | Device identity revoked | Decommissioned device attempting online sync. |
