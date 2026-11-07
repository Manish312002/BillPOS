# Architecture Document: 04 — Portal Routing and Layouts

- **Module:** `@billingbuddy/web`
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.05 — Portal Routing & Layout Hardening
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Architectural Philosophy

BillingBuddy unifies multi-tenant administrative governance (Superadmin) and daily store point-of-sale operations (Store Owner) in a single React application through explicit route namespace partitioning and isolated layout shells.

```text
apps/web/src/
├── app/
│   ├── router/index.jsx       # Route namespace mapping
│   └── store/                 # Redux Toolkit
├── components/
│   └── shared/                # Layout primitives (PageHeader, StatusBadge, NotFoundPage)
├── layouts/
│   ├── PlatformLayout.jsx     # Superadmin shell (/platform/*)
│   └── OwnerLayout.jsx        # Store Owner shell (/owner/*)
└── portals/
    ├── platform/pages/        # Superadmin views
    │   ├── PlatformOverviewPage.jsx
    │   ├── PlatformTenantsPage.jsx
    │   ├── PlatformSubscriptionsPage.jsx
    │   ├── PlatformAuditLogsPage.jsx
    │   └── PlatformSettingsPage.jsx
    └── owner/pages/           # Store Owner views
        ├── OwnerOverviewPage.jsx
        ├── OwnerBillingPage.jsx
        ├── OwnerPosPage.jsx
        ├── OwnerCustomersPage.jsx
        └── OwnerSettingsPage.jsx
```

---

## 2. Portal Hierarchy & Route Matrix

### Superadmin Namespace (`/platform/*`):
- **Theme:** Dark slate (`bg-slate-950`), sky blue accents (`text-sky-400`, `border-sky-500`).
- **Target Persona:** Platform administrator / SaaS operations.
- **Route Matrix:**
  | Path | Purpose | View Component |
  |---|---|---|
  | `/platform` | Redirects to `/platform/overview` | `<Navigate to="overview" replace />` |
  | `/platform/overview` | Platform health & system overview | `PlatformOverviewPage` |
  | `/platform/tenants` | Tenant and store directory | `PlatformTenantsPage` |
  | `/platform/subscriptions` | Subscription tier and pricing governance | `PlatformSubscriptionsPage` |
  | `/platform/audit-logs` | Immutable audit trail & security events | `PlatformAuditLogsPage` |
  | `/platform/settings` | Global system configuration & integrations | `PlatformSettingsPage` |
  | `/platform/logs` | Raw diagnostic logs placeholder | Inline placeholder |

### Store Owner Namespace (`/owner/*`):
- **Theme:** Crisp operational light background (`bg-slate-50`), emerald accents (`bg-emerald-950`, `text-emerald-300`, `border-emerald-600`).
- **Target Persona:** Store Owner, Store Manager, Cashier.
- **Route Matrix:**
  | Path | Purpose | View Component |
  |---|---|---|
  | `/owner` | Redirects to `/owner/overview` | `<Navigate to="overview" replace />` |
  | `/owner/overview` | Store daily summary & KPIs | `OwnerOverviewPage` |
  | `/owner/billing` | Billing counter & invoice history | `OwnerBillingPage` |
  | `/owner/pos` | High-speed POS counter register | `OwnerPosPage` |
  | `/owner/inventory` | Inventory product catalog | Inline placeholder |
  | `/owner/customers` | Customer ledger / Khata balances | `OwnerCustomersPage` |
  | `/owner/settings` | Store profile & thermal printer config | `OwnerSettingsPage` |

---

## 3. Reusable Layout Primitives

1. **`PageHeader` (`apps/web/src/components/shared/PageHeader.jsx`):**
   Standardized layout header providing contextual page titles, subtitles, status badge slots, and actionable button groups across both dark and light shells.
2. **`StatusBadge` (`apps/web/src/components/shared/StatusBadge.jsx`):**
   Accessible status indicator with variant styling (`active`, `pending`, `inactive`, `warning`, `info`) and pulsating dot indicator.

---

## 4. Accessibility and Responsive Shell Controls

- **Semantic Landmark Elements:** Both shells use semantic `<header>`, `<aside>`, `<nav>`, `<main>`, and `<footer>` elements.
- **Responsive Drawer:** On small screens (`< md`), sidebars transform into off-canvas drawers toggleable via an accessible button with `aria-label="Toggle Navigation"` and dimming backdrops.
- **Active Navigation State:** Navigation links use `NavLink` active callback classes to provide distinct visual cues (accent left borders and background highlights).
