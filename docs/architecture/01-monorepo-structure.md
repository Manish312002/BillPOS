# Architecture Document: 01 — Monorepo Structure & Governance

- **Module:** Cross-Monorepo Architecture
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.02 — Initialize npm Workspaces Monorepo
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Monorepo Topology

BillingBuddy is organized as an npm workspaces monorepo with explicit package boundaries, isolated dependency graphs, and root-level orchestration.

```text
BillPOS/
├── apps/
│   ├── web/                 # Single React 19 frontend for dual portals
│   └── api/                 # Independent Express 5 backend API
├── packages/
│   └── shared/              # Shared contracts, constants, and utilities
├── docs/
│   ├── architecture/        # Authoritative architectural memory
│   └── reports/             # Microtask delivery and audit reports
├── scripts/
│   └── verify-workspace.js  # Automated integrity test suite
├── package.json             # Root workspace configuration
└── package-lock.json
```

---

## 2. Workspace Responsibilities & Separation of Concerns

1. **`apps/web` (`@billingbuddy/web@0.1.0`):**
   - Single React 19 Single Page Application (SPA) driven by Vite 8.
   - Hosts dual operational portals under distinct route namespaces:
     - `/platform/*` — Platform Superadmin control plane.
     - `/owner/*` — Store Owner operational portal.
   - Enforces Tailwind CSS v4, Redux Toolkit, React Router v7, and Axios.
   - Strictly no separate frontend projects or Next.js implementations.

2. **`apps/api` (`@billingbuddy/api@0.1.0`):**
   - Standalone Node.js backend using Express 5 and pure ECMAScript Modules (`type: "module"`).
   - Database layer orchestrated with Prisma ORM 6.19.3 targeting PostgreSQL.
   - Enforces Zod schema validation for environment configuration and incoming payloads.
   - Standardized RFC 7807 problem details error responses and structured JSON logging.

3. **`packages/shared` (`@billingbuddy/shared@0.1.0`):**
   - Shared domain constants (Roles, HTTP Status Codes, Error Codes).
   - Reusable Zod validation contracts (Pagination, Health responses).
   - Business utilities (Currency arithmetic in integer paise, string sanitation, ISO date helpers).

---

## 3. Technology Restrictions & Compliance

The following technologies are strictly prohibited and continuously enforced across the codebase:

- **TypeScript (`.ts`, `.tsx`, `.d.ts`):** Prohibited. 100% pure JavaScript / JSX only.
- **Next.js:** Prohibited. Architecture is a pure Vite React SPA + Express API.
- **Tailwind CSS v3:** Prohibited. Modern Tailwind CSS v4 CSS-first engine enforced.
- **Zustand:** Prohibited. Redux Toolkit is the approved global state manager.
- **bcryptjs:** Prohibited. Native Node.js crypto / Argon2 for credentials.
- **Multi-app frontend fragmentation:** Prohibited. Single `apps/web` handles both portals.
