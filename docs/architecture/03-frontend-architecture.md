# Architecture Document: 03 — Frontend Foundation

- **Module:** `@billingbuddy/web`
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.04 — Frontend Foundation
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Single Application, Dual Portal Architecture

Rather than maintaining divergent codebases, BillingBuddy utilizes a single React frontend application (`apps/web`) capable of serving both administrative personas:
1. **Superadmin Portal (`/platform/*`):** Platform-level governance, multi-tenant directory, subscription oversight, and system logs.
2. **Store Owner Portal (`/owner/*`):** Tenant-level store operations, billing counter, inventory catalog, and local analytics.

### Principles:
- **No TypeScript:** Standard JavaScript JSX (`.js`, `.jsx`) is used exclusively.
- **Route Namespaces:** Enforced via React Router v7 (`react-router-dom@7.18.5`).
- **Layout Isolation:**
  - `PlatformLayout`: Slate/Dark theme, system monitoring focus.
  - `OwnerLayout`: Clean white/emerald theme, retail operations focus.
- **Security Boundary:** Frontend routing is organizational; authorization tokens and RBAC checks will be validated server-side by the Express API (`apps/api`) in later work packages.

---

## 2. Styling System: Tailwind CSS v4

- Configured using `@tailwindcss/vite` official Vite integration.
- Utilizes CSS-first configuration via `@import "tailwindcss";` in `src/styles/index.css`.
- Legacy `tailwind.config.js` and PostCSS dependencies are omitted, adhering to the project's strict prohibition of Tailwind v3 conventions.

---

## 3. Centralized API Client

- Instance configured in `src/services/api/client.js` using Axios (`axios@1.21.0`).
- Base URL and prefix resolved from Vite environment variables:
  - `VITE_API_BASE_URL` (default: `http://localhost:4000`)
  - `VITE_API_PREFIX` (default: `/api`)
- Standard 10-second request timeout configured.
- Minimal interceptors normalize response error envelopes (`{ message, status, code, data }`). Native `fetch()` is prohibited for application communication.

---

## 4. State Management Baseline

- Redux Toolkit (`@reduxjs/toolkit@2.14.0`) with `react-redux@9.3.1`.
- Root store initialized in `src/app/store/index.js` with a minimal `systemSlice` tracking initialization status and application metadata.
- Speculative domain slices and authentication state are strictly deferred.
