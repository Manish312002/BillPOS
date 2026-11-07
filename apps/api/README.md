# @billingbuddy/api

The independent backend API application for BillingBuddy, serving both Superadmin (`/platform/*`) and Store Owner (`/owner/*`) portals.

---

## Architecture Overview

Built with pure JavaScript (ES Modules) on Node.js and Express 5, following a modular, layered architecture:

```text
apps/api/
├── prisma/
│   └── schema.prisma        # PostgreSQL datasource & baseline schema
├── src/
│   ├── config/              # Centralized environment configuration (Zod validation)
│   │   ├── env.js
│   │   └── index.js
│   ├── db/                  # Prisma client singleton & lifecycle
│   │   └── client.js
│   ├── middleware/          # Global middleware handlers
│   │   ├── errorHandler.js  # Centralized error formatting
│   │   ├── notFoundHandler.js
│   │   └── requestLogger.js # Structured request logging
│   ├── modules/             # Feature modules (prepared for future domain packages)
│   ├── routes/              # Route aggregators
│   │   ├── health.routes.js # /api/health
│   │   └── index.js         # Top-level API router
│   ├── services/            # Business & system services
│   │   └── health.service.js
│   ├── utils/               # Shared response helpers
│   │   └── apiResponse.js
│   ├── app.js               # Express application instance factory (exported for testing)
│   └── server.js            # Server entrypoint with graceful shutdown
├── tests/
│   └── health.test.js       # Vitest & Supertest integration tests
└── .env.example             # Documented environment variables
```

---

## Technologies

- **Runtime:** Node.js (v22+)
- **Server Framework:** Express 5 (`express@5.3.0`)
- **Language:** JavaScript ES Modules (`"type": "module"`)
- **Database ORM:** Prisma (`prisma@6.19.3`, `@prisma/client@6.19.3`)
- **Database Engine:** PostgreSQL
- **Schema Validation:** Zod (`zod@4.6.7`)
- **Test Runner:** Vitest (`vitest@5.1.0`)
- **HTTP Testing:** Supertest (`supertest@7.3.1`)

---

## Available Scripts

From the repository root or inside `apps/api`:

```bash
# Start server in development mode (Node 22 native watch mode)
npm run dev --workspace=@billingbuddy/api

# Run automated tests
npm run test --workspace=@billingbuddy/api

# Start production server
npm run start --workspace=@billingbuddy/api
```

---

## Health Check Endpoint

```http
GET /api/health
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "BillingBuddy API is healthy",
  "data": {
    "status": "ok",
    "service": "billingbuddy-api",
    "version": "0.1.0",
    "environment": "development",
    "uptimeSeconds": 42,
    "timestamp": "2026-11-07T08:30:00.000Z",
    "nodeVersion": "v22.17.1",
    "memoryUsageMB": {
      "rss": 45,
      "heapTotal": 20,
      "heapUsed": 15
    }
  }
}
```
