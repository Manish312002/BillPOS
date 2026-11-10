# BillingBuddy — WP-SUB-02: Technical Specification
## Subscription & Entitlements Functional Module

- **Document Identifier:** `WP-SUB-02-SPEC`
- **Module ID:** `SUB-ENTITLEMENTS-01`
- **Version:** `1.2.0` (Updated: Resolves Clarification B & Clarification C)
- **Status:** `READY_FOR_FINAL_OWNER_REVIEW`
- **Execution Mode:** Documentation and Architecture Design Only
- **Target Repository:** `BillingBuddy` (`E:\Projects\BillPOS`)

---

## 1. Executive Summary & Separation of Concerns

This technical specification details the operational logic, lifecycle state coordination, read-only operational exceptions, and concurrency controls for BillingBuddy's **Subscription & Entitlements** module.

### Core Architectural Separation of State Domains:
1. **Tenant Platform Lifecycle (`Tenant.status`):**
   - Values: `ACTIVE`, `INACTIVE`, `SUSPENDED`.
   - Governs legal, platform, and authentication access. If `SUSPENDED`, all user authentication is rejected immediately at the gateway, independent of subscription or payments.
2. **Subscription Entitlement Lifecycle (`TenantSubscription.status`):**
   - Values: `TRIAL`, `ACTIVE`, `GRACE_PERIOD`, `READ_ONLY`, `SUSPENDED`, `CANCELED`, `EXPIRED`.
   - Governs functional feature access, POS billing permissions, and quota metering.
3. **Invoice & Payment Lifecycle (`SubscriptionInvoice.status` & `SubscriptionPayment.status`):**
   - Invoices: `DRAFT`, `ISSUED`, `PAID`, `VOID`, `UNCOLLECTIBLE`.
   - Payments: `PENDING`, `VERIFIED`, `REJECTED`, `REFUNDED`.
   - Tracks financial reconciliation. Payment submission **never** automatically modifies subscription status. Only verified payments or authorized Superadmin actions can activate or extend subscriptions.

---

## 2. Subscription and Payment Lifecycle Coordination (Clarification C)

### 2.1 The Eleven Canonical Lifecycle Scenarios

| Scenario | Trigger / Event | Actor | Preconditions | State Transitions | Transaction & Locking | Resulting Access Behavior | Audit Event | New Record Created? |
|---|---|---|---|---|---|---|---|---|
| **1. Payment Submitted** | Store Owner submits bank UTR | Store Owner | Unpaid invoice exists; UTR unique | `SubscriptionPayment`: `[None] → PENDING`. `SubscriptionInvoice`: `ISSUED`. `TenantSubscription`: **UNCHANGED**. | Lock `SubscriptionInvoice`; insert `SubscriptionPayment`. | Governed by existing subscription state (`TRIAL`, `ACTIVE`, `GRACE_PERIOD`, `READ_ONLY`). Submission grants zero automatic access. | `SUBSCRIPTION_PAYMENT_SUBMITTED` | New `SubscriptionPayment` row; existing subscription row untouched. |
| **2. Payment Rejected** | Superadmin rejects invalid UTR | Superadmin (TOTP) | Payment `PENDING`; rejection reason $\ge 10$ chars | `SubscriptionPayment`: `PENDING → REJECTED`. `SubscriptionInvoice`: remains `ISSUED`. `TenantSubscription`: **UNCHANGED**. | Lock `SubscriptionPayment`; update status and rejection reason. | Unaffected by rejection; subscription clock continues (enters grace or read-only per schedule). | `SUBSCRIPTION_PAYMENT_REJECTED` | No new records; payment row updated. |
| **3. Payment Verified** | Superadmin approves bank transfer | Superadmin (TOTP) | Payment `PENDING`; amount matches invoice | `SubscriptionPayment`: `PENDING → VERIFIED`. `SubscriptionInvoice`: `ISSUED → PAID`. `TenantSubscription`: `[TRIAL\|GRACE\|READ_ONLY] → ACTIVE`. | Lock `TenantSubscription` $\rightarrow$ `Invoice` $\rightarrow$ `Payment` in order. | Full operational access restored/activated; fresh 72h offline lease issued. | `SUBSCRIPTION_PAYMENT_VERIFIED` | Existing subscription updated (`currentPeriodEnd = now + interval`); no duplicate subscription row. |
| **4. Renewal Submitted Early** | Owner submits renewal payment before expiry | Store Owner | Subscription `ACTIVE`; renewal invoice issued | `SubscriptionPayment`: `[None] → PENDING`. `TenantSubscription`: remains `ACTIVE`. | Lock `SubscriptionInvoice`; insert `SubscriptionPayment`. | Uninterrupted full operational access. | `SUBSCRIPTION_PAYMENT_SUBMITTED` | New `SubscriptionPayment` row. |
| **5. Renewal Pending in Grace** | Period ended; payment submitted during 72h grace | System Cron / Store Owner | Subscription entered `GRACE_PERIOD`; payment pending | `TenantSubscription`: remains `GRACE_PERIOD`. `SubscriptionPayment`: `PENDING`. | Lock `TenantSubscription`. | Full POS and backoffice access continues with amber warning banner. | `SUBSCRIPTION_GRACE_PAYMENT_PENDING` | Payment row created; subscription row untouched. |
| **6. Renewal Rejected in Grace** | Superadmin rejects UTR during grace | Superadmin (TOTP) | Payment `PENDING`; subscription `GRACE_PERIOD` | `SubscriptionPayment`: `PENDING → REJECTED`. `TenantSubscription`: remains `GRACE_PERIOD`. | Lock `SubscriptionPayment`. | Access continues in grace until `gracePeriodEndsAt` passes, after which cron moves tenant to `READ_ONLY`. | `SUBSCRIPTION_PAYMENT_REJECTED` | Payment row updated. |
| **7. Manual Period Extension** | Superadmin grants complimentary days | Superadmin (TOTP) | Valid TOTP; mandatory justification | `TenantSubscription`: `currentPeriodEnd = currentPeriodEnd + extensionDays`; status maintained/set to `ACTIVE`. | Lock `TenantSubscription`. | Operational access extended by specified days. | `SUBSCRIPTION_PERIOD_EXTENDED` | Zero payment records created; subscription row updated. |
| **8. Tenant Suspended Independently** | Compliance / legal hold on tenant account | Superadmin (TOTP) | Valid TOTP; compliance violation | `Tenant.status`: `ACTIVE → SUSPENDED`. `TenantSubscription.status`: **UNCHANGED**. | Lock `Tenant` row. | Gateway blocks all tenant access (`403 TENANT_SUSPENDED`). Subscription history preserved without modification. | `TENANT_SUSPENDED` | Tenant row updated; zero subscription changes. |
| **9. Tenant Reinstated** | Compliance hold released | Superadmin (TOTP) | Tenant `SUSPENDED`; compliance restored | `Tenant.status`: `SUSPENDED → ACTIVE`. `TenantSubscription`: dynamically evaluated. | Lock `Tenant` row. | If `now < currentPeriodEnd`, access restored to `ACTIVE`. If expired during suspension, access transitions to `READ_ONLY`. | `TENANT_REINSTATED` | Tenant row updated. |
| **10. Cancellation at Period End** | Owner requests scheduled cancellation | Store Owner | Subscription `ACTIVE` | `TenantSubscription.cancelAtPeriodEnd = true`. Status remains `ACTIVE`. | Lock `TenantSubscription`. | Full operational access until `currentPeriodEnd`. Upon expiry, cron transitions status to `CANCELED`. | `SUBSCRIPTION_CANCEL_SCHEDULED` | Subscription row updated with cancellation flag. |
| **11. Subscription Reactivated** | Tenant resubscribes after cancellation | Superadmin / Store Owner | Prior subscription in `CANCELED` or `EXPIRED` | Prior subscription row remains `CANCELED`/`EXPIRED`. **NEW** `TenantSubscription` created with `status = 'ACTIVE'`. | Insert new `TenantSubscription` within transaction. | New active commercial cycle initiated. Historical records preserved. | `SUBSCRIPTION_REACTIVATED` | **NEW** `TenantSubscription` row created (permitted by partial unique index). |

---

## 3. Four-Tier Financial Architecture & Decimal Integer Strings (Clarification B)

To guarantee zero IEEE 754 precision loss across all client languages and runtime boundaries:

```
[Tier 1: PostgreSQL Persistence]
 PostgreSQL BIGINT (Paise) -> Prisma BigInt (99900n)
              |
              v
[Tier 2: Application Calculation]
 Native JavaScript BigInt arithmetic via @billingbuddy/shared. Zero floats.
              |
              v
[Tier 3: External API Wire Representation]
 Canonical Decimal Integer Strings:
 {
   "amountPaise": "99900",
   "amountFormatted": "₹999.00"
 }
              |
              v
[Tier 4: UI Human-Readable Presentation]
 Localized string rendered via formatINR("99900")
```

### 3.1 Arithmetic Rules:
1. All monetary quantities represent integer paise (₹1 = 100 paise).
2. All additions, subtractions, and multiplications are executed using integer math before any division.
3. Tax rounding utilizes round-half-up integer division:
   $$\text{taxPaise} = \left\lfloor \frac{\text{subtotalPaise} \times \text{taxRatePercent} + 50}{100} \right\rfloor$$
4. Float data types (`Number` with decimals) are strictly prohibited for monetary calculations.

---

## 4. Read-Only Access Policy Specification

When a tenant enters `READ_ONLY` mode (Day 4+ past expiry):
- **Allowed Operations:** Viewing past receipts, downloading tax invoice PDFs, generating accounting report exports, viewing billing history, and submitting renewal payment UTRs.
- **Blocked Operations (`403 FORBIDDEN: SUBSCRIPTION_READ_ONLY`):** POS checkout/bill settlement, refunds, catalog edits, outlet creation, user invitations, and new shift opening.
- **Conditional Exception:** Closing pre-existing open cash shifts is permitted to allow cashiers to balance registers.
