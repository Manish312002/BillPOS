# Architecture Document: 06 — Development Tooling and Developer Experience

- **Module:** Monorepo Root (`scripts/`, `eslint.config.js`, `package.json`)
- **Work Package:** WP-01 — Project Foundation
- **Microtask:** BB-WP01-01.07 — Development Tooling & Scripts
- **Date:** 2026-11-07
- **Status:** Approved Baseline

---

## 1. Tooling Principles

Development tooling in BillingBuddy is designed to support rapid, deterministic workflows while maintaining strict architectural boundaries.

### Guiding Standards:
1. **Zero Transpilation Friction:** Pure JavaScript ES Modules throughout all workspaces eliminate TypeScript compilation build steps.
2. **Standardized Formatting:** Enforced via Prettier (`prettier@3.9.10`) matching `.editorconfig` (2-space indent, single quotes, trailing commas, LF line endings).
3. **Modern Linting:** ESLint 10 (`eslint@10.14.0`) configured with modern flat configuration (`eslint.config.js`) supporting ECMAScript 2024 and React 19 JSX syntax.
4. **Deterministic Audits:** Automated verification script (`scripts/verify-workspace.js`) provides an instant, repeatable integrity check across the entire monorepo.

---

## 2. Root Script Commands

The root `package.json` provides centralized task orchestration:

| Script | Command Target | Description |
|---|---|---|
| `verify` | `node scripts/verify-workspace.js` | Runs comprehensive runtime, workspace, lint, format, test, and build audit |
| `dev:api` | `apps/api` | Starts Express 5 API in Node 22 native watch mode (`--watch`) |
| `dev:web` | `apps/web` | Starts Vite 8 development server on port 5173 |
| `build` | `apps/web` | Compiles optimized production bundle |
| `test` | All workspaces | Executes Vitest suites across `api`, `web`, and `shared` |
| `test:api` | `apps/api` | Executes backend integration test suite |
| `test:web` | `apps/web` | Executes frontend routing and layout test suite |
| `test:shared` | `packages/shared` | Executes shared utility & contract test suite |
| `lint` | Monorepo root | Runs ESLint across all JavaScript/JSX source files |
| `format` | Monorepo root | Auto-formats codebase according to `.prettierrc` |
| `format:check`| Monorepo root | Validates formatting compliance |

---

## 3. Automated Workspace Verifier (`scripts/verify-workspace.js`)

Performs 8 automated integrity checks:
1. Node.js version constraint check (`>= 22.12.0`).
2. Workspace directory and `package.json` existence check for `apps/web`, `apps/api`, and `packages/shared`.
3. Git secrets protection check confirming `.env` rules in `.gitignore`.
4. Zero TypeScript enforcement recursively verifying no `.ts` or `.tsx` files exist in project source directories.
5. ESLint validation check verifying 0 lint issues.
6. Prettier formatting check confirming adherence to code style.
7. Test runner verification executing test suites across all workspaces.
8. Frontend production build verification ensuring bundle generation succeeds.
