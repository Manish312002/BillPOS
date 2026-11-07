# BillingBuddy (Greenfield Architecture)

Production-oriented monorepo for BillingBuddy retail operations and point-of-sale platform.

---

## 1. Monorepo Architecture

Managed via npm workspaces with pure JavaScript ES Modules (`"type": "module"`):

```text
BillPOS/
├── apps/
│   ├── api/                 # Independent Express 5 backend API
│   └── web/                 # Unified React 19 + Tailwind v4 frontend
├── packages/
│   └── shared/              # Shared contracts, constants, & integer-paise utilities
├── docs/
│   ├── architecture/        # Architecture memory records (01–06)
│   └── reports/             # Microtask acceptance reports
├── scripts/
│   └── verify-workspace.js  # Automated repository integrity & health verification
├── eslint.config.js         # ESLint flat config (ECMAScript 2024 / React 19 JSX)
├── .editorconfig            # Standardized line endings & indentation
├── .prettierrc              # Prettier formatting rules
└── package.json             # Root monorepo configuration
```

---

## 2. Technology Decisions

| Layer | Technology | Specification |
|---|---|---|
| **Runtime** | Node.js | `>=22.12.0` (Verified on Node 22) |
| **Language** | JavaScript | ES Modules (`"type": "module"`), **Zero TypeScript** |
| **Frontend** | React 19 + Vite 8 | JSX only, React Router v7 |
| **Styling** | Tailwind CSS v4 | CSS-first `@import "tailwindcss"` via `@tailwindcss/vite` |
| **State** | Redux Toolkit | `@reduxjs/toolkit` + `react-redux` |
| **HTTP Client**| Axios | Centralized client with error normalization |
| **Backend** | Express 5 | Native async promise error handling |
| **ORM** | Prisma 6 | Stable PostgreSQL schema with integer arithmetic |
| **Validation** | Zod | Runtime schema validation & fail-fast config |
| **Testing** | Vitest | In-process testing with Supertest & Testing Library |

---

## 3. Dual-Portal Routing Architecture

The single React application (`apps/web`) supports two segregated portal experiences:

- **Superadmin (`/platform/*`):** Multi-tenant management, subscription tiering, platform settings, and audit logs. Styled with dark slate aesthetics.
- **Store Owner (`/owner/*`):** POS counter, billing register, inventory catalog, customer ledger, and store settings. Styled with clean retail emerald accents.
- **Root Entry (`/`):** Switchboard landing page directing to either portal namespace.
- **Fallback (`*`):** 404 Route Not Found page.

---

## 4. Quick Start & Common Scripts

From the repository root:

```bash
# Verify monorepo health and environment integrity
npm run verify

# Run automated tests across all workspaces
npm run test

# Run tests by workspace
npm run test:api
npm run test:web
npm run test:shared

# Start development servers
npm run dev:api     # Backend API on port 4000 (Node 22 native watch mode)
npm run dev:web     # Frontend Vite server on port 5173

# Lint and format checks
npm run lint
npm run format:check
npm run format

# Production build
npm run build
```
