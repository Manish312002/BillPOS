# Architecture Document: 05 — Shared Package Architecture

- **Module:** `@billingbuddy/shared`
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.06 — Shared Package Foundation
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Architectural Philosophy

`packages/shared` houses truly shared, boundary-crossing contracts, constants, and utilities consumed by both the frontend (`apps/web`) and the backend (`apps/api`).

### Core Rules:
1. **Zero TypeScript:** Written in pure, modern ECMAScript standard (`.js`).
2. **Framework Agnostic:** Zero Express, React, Vite, or DOM dependencies. Can be imported in Node.js server environments or browser runtimes.
3. **No Premature Business Logic:** Contains purely structural contracts (pagination, health schemas), constants (roles, error codes, HTTP statuses), and foundational mathematical/string helpers.
4. **Subpath Exports:** Provides clean subpath exports defined in `package.json` (`@billingbuddy/shared/constants`, `@billingbuddy/shared/contracts`, `@billingbuddy/shared/utils`).

---

## 2. Retail Currency Engineering (Integer Paise Arithmetic)

In retail point-of-sale applications, standard JavaScript floating-point numbers (`Number`) are prone to precision artifacts due to IEEE 754 representations (e.g. `0.1 + 0.2 !== 0.3`).

To eliminate floating-point drift:
- All monetary amounts stored and computed internally must be in **integer paise** (1 Rupee = 100 Paise).
- `rupeesToPaise(rupees)` safely parses and converts rupee input to an integer.
- `paiseToRupees(paise)` converts integer paise to float rupees for presentation.
- `formatINR(paise)` formats integer paise using the official `en-IN` currency format (`₹1,249.50`).

---

## 3. Validation Contracts

Using Zod (`zod@4.6.7`), `@billingbuddy/shared` defines shared validation schemas:
- `paginationQuerySchema`: Enforces safe query limits (default 20, max 100), page numbers, sort directions.
- `paginationMetaSchema`: Standardized pagination metadata format.
- `healthResponseSchema`: Strict schema verifying health check API payloads.
