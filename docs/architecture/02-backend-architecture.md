# Architecture Document: 02 — Backend Foundation

- **Module:** `@billingbuddy/api`
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.03 — Backend Foundation
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Architectural Philosophy

The backend is built as an independent, modular Express 5 service using pure JavaScript ES Modules (`"type": "module"`). It acts as the single backend application serving both Superadmin (`/platform/*`) and Store Owner (`/owner/*`) portals.

### Core Architecture Principles:
1. **Zero TypeScript:** Written in pure, modern ECMAScript standard. No compilation or transpilation pipeline is required for backend code.
2. **Layered Separation of Concerns:**
   - `config/`: Centralized environment parsing with strict schema validation.
   - `middleware/`: Standardized request processing, logging, not-found routing, and centralized error normalization.
   - `routes/`: Route definitions and middleware mapping without heavy business logic.
   - `services/`: Business logic, domain rules, and data aggregation.
   - `db/`: Prisma client singleton with lifecycle management (connect / graceful disconnect).
   - `utils/`: Reusable helpers such as structured API response envelopes.
3. **Fail-Fast Configuration:** `src/config/env.js` validates environment variables on process startup using Zod. If mandatory variables are missing or malformed, the process logs exact schema violations and exits immediately.
4. **Decoupled Application and Server:** `src/app.js` configures Express routes, middleware, and parsers without binding to a network port. This enables Supertest to perform fast in-process HTTP assertions against `app` without port contention.

---

## 2. Standardized API Response Contract

All endpoints adhere to a standardized envelope format:

### Success Format:
```json
{
  "success": true,
  "message": "Human-readable summary",
  "data": { ... },
  "meta": { ... } // Optional pagination / context
}
```

### Error Format:
```json
{
  "success": false,
  "message": "Human-readable error description",
  "code": "ERROR_CODE",
  "errors": [ ... ] // Optional detailed field errors (e.g. Zod validation issues)
}
```

---

## 3. Database Layer & Prisma Version Strategy

- **ORM:** Prisma (`prisma@6.19.3`, `@prisma/client@6.19.3`)
- **Database Engine:** PostgreSQL
- **Rationale for Prisma 6:**
  Prisma 7 introduces breaking architectural changes requiring `prisma.config.ts` and driver adapters for database connection strings, conflicting with the project's strict prohibition of TypeScript files (`.ts` / `.tsx`). Prisma 6.19.3 is the latest stable release that natively supports standard `schema.prisma` configuration (`url = env("DATABASE_URL")`) in pure JavaScript ES Modules environments.

---

## 4. Health & Observability Foundation

The baseline service provides:
- `GET /`: Lightweight service ping.
- `GET /api/health`: Comprehensive system health report containing:
  - Uptime (seconds)
  - Process memory metrics (RSS, heap total, heap used in MB)
  - Runtime environment & Node.js version
  - ISO timestamp
