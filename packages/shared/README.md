# @billingbuddy/shared

Shared constants, Zod validation contracts, and pure JavaScript utilities for the BillingBuddy monorepo (`apps/api` and `apps/web`).

---

## Package Overview

Written in standard JavaScript ES Modules (`"type": "module"`). Contains reusable, domain-agnostic contracts and helpers:

```text
packages/shared/
├── src/
│   ├── constants/
│   │   ├── roles.js           # Platform & Store role identifiers
│   │   ├── httpStatus.js      # Standard HTTP status codes
│   │   ├── errorCodes.js      # Global application error codes
│   │   └── index.js
│   ├── contracts/
│   │   ├── pagination.contracts.js # Pagination query & meta Zod schemas
│   │   ├── health.contracts.js     # System health check validation schema
│   │   └── index.js
│   ├── utils/
│   │   ├── currency.js        # Retail currency & integer paise arithmetic
│   │   ├── string.js          # Slugify, trim, sanitize, truncate
│   │   ├── date.js            # Standardized date & ISO formatting
│   │   └── index.js
│   └── index.js               # Main package entrypoint
├── tests/
│   └── shared.test.js         # Vitest unit test suite
└── package.json
```

---

## Exports & Usage

```javascript
// Import from root or subpath exports
import { PLATFORM_ROLES, TENANT_ROLES, HTTP_STATUS, ERROR_CODES } from '@billingbuddy/shared/constants';
import { paginationQuerySchema, healthResponseSchema } from '@billingbuddy/shared/contracts';
import { rupeesToPaise, paiseToRupees, formatINR, slugify } from '@billingbuddy/shared/utils';
```

---

## Available Scripts

```bash
# Run unit tests
npm run test --workspace=@billingbuddy/shared
```
