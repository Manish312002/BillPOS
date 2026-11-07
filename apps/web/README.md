# @billingbuddy/web

The unified React frontend application for BillingBuddy, supporting both the Superadmin (`/platform/*`) and Store Owner (`/owner/*`) portals through modular route namespaces and layouts.

---

## Architecture Overview

Built with pure JavaScript (JSX) on React 19, Vite, Tailwind CSS v4, Redux Toolkit, React Router, and Axios:

```text
apps/web/
├── public/                  # Public assets
├── src/
│   ├── app/
│   │   ├── router/          # Top-level React Router route definitions
│   │   │   └── index.jsx
│   │   └── store/           # Redux Toolkit root store & slices
│   │       ├── index.js
│   │       └── systemSlice.js
│   ├── components/
│   │   └── shared/          # Shared components (PortalIndexPage, NotFoundPage)
│   ├── layouts/
│   │   ├── PlatformLayout.jsx # Superadmin portal layout (/platform/*)
│   │   └── OwnerLayout.jsx    # Store Owner portal layout (/owner/*)
│   ├── portals/
│   │   ├── platform/        # Superadmin portal views
│   │   │   └── pages/
│   │   │       ├── PlatformOverviewPage.jsx
│   │   │       └── PlatformTenantsPage.jsx
│   │   └── owner/           # Store Owner portal views
│   │       └── pages/
│   │           ├── OwnerOverviewPage.jsx
│   │           └── OwnerBillingPage.jsx
│   ├── services/
│   │   └── api/             # Centralized Axios client
│   │       └── client.js
│   ├── styles/
│   │   └── index.css        # Tailwind CSS v4 entrypoint (@import "tailwindcss")
│   ├── App.jsx              # Application root with Provider & BrowserRouter
│   └── main.jsx             # DOM mounting entrypoint
├── tests/
│   └── frontend.test.jsx    # Vitest & React Testing Library tests
├── index.html               # Vite HTML entry
└── vite.config.js           # Vite + Tailwind v4 + React configuration
```

---

## Dual-Portal Routing Namespaces

| Namespace | Portal | Target Persona | Distinct Styling & Navigation |
|---|---|---|---|
| `/platform/*` | Superadmin | Platform Governance | Slate / Zinc neutral workspace, Dark slate header, platform governance links |
| `/owner/*` | Store Owner | Tenant / Cashier | Retail operations styling with Emerald accents, register & inventory links |
| `/` | Portal Index | Shared | Neutral gateway directing to respective portal namespaces |
| `*` | Catch-All | Fallback | Structured 404 Route Not Found page |

> **Security Note:** Structural frontend route separation provides navigation and user-experience partitioning. True authorization is enforced server-side by the API in subsequent work packages.

---

## Available Scripts

From the repository root or inside `apps/web`:

```bash
# Start Vite development server
npm run dev --workspace=@billingbuddy/web

# Build optimized production bundle
npm run build --workspace=@billingbuddy/web

# Preview production build locally
npm run preview --workspace=@billingbuddy/web

# Run automated unit/integration tests
npm run test --workspace=@billingbuddy/web
```
