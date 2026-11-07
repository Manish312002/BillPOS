# ADR-002 — Zero-Cost Authentication, Superadmin TOTP & Manual WhatsApp Invitations

- **Project:** BillingBuddy (Greenfield Architecture)
- **Work Package:** WP-02 — Authentication & Access Foundation
- **Status:** APPROVED BASELINE
- **Date:** 2026-11-07
- **Supersedes:** Previous automated WhatsApp OTP decisions

---

## 1. Context & Business Constraints

BillingBuddy requires a secure, production-grade authentication and access control architecture with a strict messaging budget of **₹0**.

The following are strictly prohibited:
- Paid WhatsApp Business Cloud API.
- Twilio, Gupshup, or any paid third-party SMS/WhatsApp gateway.
- Unofficial browser scraping or fragile WhatsApp automation bots.
- Automated outbound OTP delivery.

The architecture must support Superadmin authentication, Store Owner invitation and activation, secure sessions, and multi-tenant isolation without relying on paid messaging infrastructure.

---

## 2. Approved Architectural Decisions

### ADR-002.1 — Superadmin Authentication
**Decision: RFC 6238 App-Based TOTP Authentication.**

Superadmin authentication requires:
1. Registered phone number or email and password.
2. Six-digit TOTP from an enrolled authenticator application (Google Authenticator, Microsoft Authenticator, Apple Passwords, or any RFC 6238-compliant application).
3. Successful server-side verification before platform dashboard access.

**Requirements:**
- Cryptographically secure TOTP secret generation (base32-encoded 20-byte random seed).
- Standard 30-second TOTP time steps using HMAC-SHA1 (RFC 6238 standard) or HMAC-SHA256.
- Narrowly bounded clock-drift verification window ($\pm 1$ step = $\pm 30\text{s}$).
- Storage of TOTP secrets encrypted at rest in PostgreSQL, never in plaintext.
- Authenticator enrollment flow required on initial Superadmin bootstrap/login before dashboard grant.
- Provisioning of hashed, single-use recovery backup codes for emergency access.
- Strict rate limiting on TOTP verification attempts (max 5 consecutive failures before lockout).
- Zero logging of TOTP secrets, recovery codes, or submitted token values.

### ADR-002.2 — Owner Invitation & Activation
**Decision: Manual WhatsApp Invitation with Secure Bearer Link.**

1. Superadmin creates a tenant and issues an Owner invitation from the dashboard.
2. Backend generates a cryptographically random 256-bit opaque invitation token (`generateOpaqueToken()`).
3. Backend stores only its SHA-256 hash (`hashToken()`) in PostgreSQL with a strict 12-hour expiry timestamp.
4. Backend/frontend formats an official WhatsApp Click-to-Chat URL using `wa.me`.
5. Superadmin explicitly clicks the `"Share Invitation via WhatsApp"` action button.
6. WhatsApp Web or Desktop opens with the owner's chat and pre-filled message; Superadmin manually presses Send.

**Activation Lifecycle:**
- Single-use 12-hour bearer token.
- Invalidated immediately upon successful acceptance or when superseded/revoked on resend.
- Possession of the invitation link delivered through the Owner's private WhatsApp chat is the activation proof. No separate WhatsApp OTP is required.
- The invitation URL/secret must never be recorded in audit logs or telemetry.

### ADR-002.3 — WhatsApp Messaging
**Decision: Manual Click-to-Chat (`wa.me`) Only.**

Format:
`https://wa.me/{international_digits_only_phone}?text={url_encoded_message}`

**Requirements:**
- Normalize phone numbers to international digits-only format (e.g. `+91 83809-89776` $\rightarrow$ `918380989776`).
- Properly URL-encode message content.
- Validate destination phone numbers.
- Links are generated solely following explicit user gestures.
- Zero automated outbound messaging.
- Never claim delivery when WhatsApp is merely opened.
- Exclude passwords, session tokens, or internal secrets from message templates.
- **No WhatsApp messaging API or external provider abstraction will be implemented.**

### ADR-002.4 — Invitation Status Semantics
**Decision: UI/API Label `INVITED_PENDING_ACCEPTANCE`.**

- Persisted database enum: `InvitationStatus.PENDING`.
- Semantic API / UI label: `INVITED_PENDING_ACCEPTANCE`.
- Represents: Invitation created, link generated, WhatsApp sharing initiated by Superadmin, owner acceptance pending.
- Does not represent: Guaranteed message delivery or read confirmation.

### ADR-002.5 — Store Owner Login
**Decision: Credential Login without OTP.**

Owner login requires:
1. Registered phone number or email.
2. Password (verified via `bcrypt`).
3. Active account status and valid tenant membership.
4. Mandatory completion of the 6-step store onboarding wizard before operational POS/billing access.

No WhatsApp OTP is required for Store Owner login.

### ADR-002.6 — Session Architecture
**Decision: Opaque Server-Side PostgreSQL Sessions.**

Session validity policies:
| Role | Idle Timeout | Absolute Lifetime |
|---|:---:|:---:|
| **Platform Superadmin** | 30 minutes | 12 hours |
| **Store Owner** | 12 hours | 7 days |

**Requirements:**
- Store only SHA-256 session token hashes in PostgreSQL.
- Transmit session tokens over `httpOnly`, `Secure` (production), `SameSite=Lax` cookies.
- Enforce CSRF protection on state-mutating requests.
- Rotate session tokens upon privilege escalation (e.g. after successful TOTP verification).
- Immediately revoke sessions on logout, password change, or suspension.

### ADR-002.7 — Password & Recovery Policy
- Password hashing: native `bcrypt` with cost factor 12.
- Superadmin initial password change remains mandatory (`mustChangePassword: true`).
- TOTP recovery codes are single-use, cryptographically random, and stored hashed in PostgreSQL.
- Email verification remains disabled in foundation phase.

### ADR-002.8 — Security & Tenant Isolation
- Zero trust for browser-supplied tenant IDs or role claims; derived strictly server-side from active session.
- Cross-tenant IDOR defense via strict tenant-scoped database queries (`where: { tenantId }`).
- Onboarding route guards prevent access to POS/billing routes until Step 6 completion.
- Zero secret leakage in logs, error exceptions, or API response bodies.

---

## 3. Architecture Impact Matrix

| Component | Previous Design | Revised Approved ADR-002 Design |
|---|---|---|
| **WhatsApp Service** | Abstract provider + mock + external API interfaces | Clean, lightweight `wa.me` Click-to-Chat URL generator utility |
| **Superadmin 2FA** | Server-sent automated WhatsApp OTP | Offline RFC 6238 TOTP (Google/Microsoft Authenticator) |
| **Owner Invitation** | API-dispatched WhatsApp message | Superadmin clicks "Share on WhatsApp" $\rightarrow$ opens `wa.me` link |
| **Owner Activation** | 12h Link + separate WhatsApp OTP | 12h secure bearer link delivered to private WhatsApp chat |
| **Messaging Infrastructure Cost** | Required paid API budget | **Strictly ₹0** |
| **External Telecom Dependency** | High (subject to WhatsApp API outages) | Zero (Superadmin TOTP is 100% offline & resilient) |
