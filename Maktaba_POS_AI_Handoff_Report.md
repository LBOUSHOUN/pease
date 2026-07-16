# Maktaba POS — Complete AI Handoff Report

**Repository:** `C:\laragon\www\maktaba-pos`  
**Purpose:** Give another AI enough context to continue without restarting, duplicating work, or breaking the current applications.

## 1. Executive status

The repository now contains two separate systems:

1. **Offline desktop POS** in `apps/desktop`
   - Tauri 2
   - Rust
   - React + Vite + TypeScript
   - SQLite
   - Substantially implemented and kept as the offline/reference version

2. **Online web/PWA system** in `apps/api` and `apps/web`
   - Fastify + TypeScript API
   - PostgreSQL + Drizzle
   - React + Vite PWA
   - Docker Compose + Caddy foundation
   - Online foundation is complete and stabilized
   - Online business modules are not yet ported

The immediate next task is **Online Phase 2: categories, products, services, stock, stock movements, internal barcode/QR identifiers, and USB scanner input**.

There is currently **no offline/online synchronization**. The SQLite and PostgreSQL systems must not both accept real production sales at the same time.

---

## 2. Original project objective

Build a professional but lightweight management system for a small Moroccan stationery/bookshop.

Required final capabilities:

- French interface
- MAD currency
- Products and services
- Categories
- Stock and inventory movements
- Low-stock alerts
- USB barcode scanner
- Internal Code 128 and QR identifiers
- Cash register opening and closing
- Cash sales
- Customer-credit sales
- Partial cash/credit sales
- Customers and debt payments
- Suppliers and purchases
- Expenses
- Returns/refunds
- Employees and roles
- Reports and CSV exports
- Printing
- Backups
- Access from phone, tablet, shop PC, and other PCs

---

## 3. Desktop/Tauri history

The project initially contained only a React/Vite/Tauri starter.

The first Rust builds failed because VS Code alone was not enough. Visual Studio 2022 Build Tools and MSVC were installed and verified.

Useful checks that passed:

```powershell
where.exe cl
rustup default stable-x86_64-pc-windows-msvc
rustc --version
```

Correct desktop working directory:

```powershell
cd C:\laragon\www\maktaba-pos\apps\desktop
```

The desktop app built successfully:

```powershell
npm run build
npm run tauri -- build
```

Generated files included:

```text
apps\desktop\src-tauri\target\release\desktop.exe
apps\desktop\src-tauri\target\release\bundle\msi\desktop_0.1.0_x64_en-US.msi
apps\desktop\src-tauri\target\release\bundle\nsis\desktop_0.1.0_x64-setup.exe
```

These installers were generated before final completion and are not the final production installers.

---

## 4. Offline desktop application

### 4.1 Location and role

Path:

```text
C:\laragon\www\maktaba-pos\apps\desktop
```

Stack:

- Tauri 2
- Rust
- React
- Vite
- TypeScript
- SQLite

SQLite database path:

```text
%APPDATA%\com.maktaba.pos\maktaba-pos.sqlite3
```

The desktop app should now be treated as:

- frozen offline fallback
- business-rule reference
- future SQLite-to-PostgreSQL migration source

Do not rewrite it while working on the online phases unless a specific offline bug must be fixed.

### 4.2 Offline authentication and roles

Implemented:

- First-owner onboarding
- Argon2 password hashing
- Local login/logout
- Backend session state
- Roles:
  - `global_admin`
  - `manager`
  - `cashier`
  - `stock_worker`
- Backend permission checks
- Worker management
- Temporary password reset
- Forced password change
- Final global-admin protection
- Inactive-user rejection
- Audit logging

Key file:

```text
apps/desktop/src-tauri/src/workforce.rs
```

Documentation:

```text
docs/WORKERS.md
```

### 4.3 Offline categories, products, services, and stock

Implemented:

- Categories
- Physical products
- Service products
- Sequential internal barcodes
- Stable QR identifiers
- Stock adjustments
- Stock movements
- Low-stock/out-of-stock states
- USB scanner buffering
- Duplicate-scan prevention

Services do not track or reduce stock.

### 4.4 Offline cash register and POS

Implemented:

- Register opening
- Register closing
- Cash sales
- Full credit sales
- Partial cash/credit sales
- Idempotent sale submission
- Transactional stock changes
- Transactional customer-debt changes
- Cash movements
- Audit logs

### 4.5 Offline customers and credit

Implemented:

- Customer management
- Current debt
- Customer credit ledger
- Cash debt payments
- Register updates
- Transactional debt changes

### 4.6 Offline suppliers and purchases

Implemented:

- Suppliers
- Supplier debt
- Supplier cash payments
- Multi-line purchases
- Stock increases
- Purchase-price history
- Cash-out movements
- Audit logging

Documentation:

```text
docs/PURCHASES.md
```

### 4.7 Offline expenses

Implemented:

- Expense creation
- Paginated queries
- Expense correction backend and UI
- Original record preservation
- Linked negative correction record
- Duplicate correction prevention
- Cash-balance restoration
- Audit logging

### 4.8 Offline returns/refunds

Implemented end to end:

- Full and partial returns
- Multi-item returns
- Remaining-quantity validation
- Credit-before-cash allocation
- Open-register requirement for cash refunds
- Customer-debt reduction
- Optional restocking
- Damaged/non-restocked handling
- Service-return handling
- Return history
- Sale status updates
- Idempotency protection
- Printable return summary

Allocation rule example:

```text
Original sale: 500 MAD
Cash paid: 200 MAD
Credit: 300 MAD

Return 100 MAD:
Debt reduction: 100 MAD
Cash refund: 0 MAD

Return 400 MAD:
Debt reduction: 300 MAD
Cash refund: 100 MAD
```

Documentation:

```text
docs/RETURNS.md
```

### 4.9 Offline denomination closing

Implemented MAD denominations:

- 200
- 100
- 50
- 20
- 10
- 5
- 2
- 1
- 0.50

Implemented:

- Rust-side total recalculation
- Denomination persistence
- Difference-reason enforcement
- Closing audit and cash movement
- Printable closing summary

### 4.10 Offline reports and CSV

Rust modules:

```text
apps/desktop/src-tauri/src/reports.rs
apps/desktop/src-tauri/src/exports.rs
```

Documentation:

```text
docs/REPORTS.md
docs/CSV_EXPORTS.md
```

Added Rust dependency:

```text
csv 1.4
```

Commands:

- `run_report`
- `export_csv`

Routes:

- `/reports`
- `/reports/:kind`

Implemented:

- Permission-filtered report hub
- Date presets and custom dates
- Server-side pagination
- Summary metrics
- Detail tables
- Filtered exports
- Sales totals after returns
- Estimated profit from saved purchase-price snapshots
- Returned-quantity cost exclusion
- Stock valuation excluding services
- Customer/supplier debt summaries
- Net expenses with corrections
- Basic worker report

CSV implementation:

- Rust `csv` crate
- UTF-8 BOM
- Semicolon separator
- CRLF endings
- Correct quote/newline/separator escaping
- Spreadsheet-formula injection protection for `=`, `+`, `-`, `@`, tabs, and carriage returns
- Backend permissions
- Structured result: path, row count, type, file size

### 4.11 Offline backup/printing

Implemented:

- SQLite backup
- Backup validation
- Safety copy before restore
- Restore
- Shared WebView/browser print foundation

Known offline limitations:

- Large requested integration-test matrix not fully complete
- Some print templates are shared rather than dedicated 58/80 mm layouts
- Closing report is concise rather than a complete movement-category statement
- Some report/export datasets remain less detailed than originally planned

### 4.12 Offline verification reached

Reported at different increments:

- TypeScript passed
- ESLint passed with zero warnings
- Frontend build passed
- Rust formatting passed
- Rust Clippy with `-D warnings` passed
- Frontend tests reached at least 7
- Rust tests reached at least 10
- Tauri executable opened successfully

---

## 5. Why the online system was added

The user wants the same live data from multiple devices.

SQLite is local to one computer and should not be shared directly for concurrent internet/network writes.

Target architecture:

```text
Phone / Tablet / PC / Future Desktop Client
                    |
                  HTTPS
                    |
             React Web / PWA
                    |
               Fastify API
                    |
               PostgreSQL
```

Planned VPS stack:

```text
Ubuntu VPS
├── Caddy
├── React/PWA
├── Fastify API
├── PostgreSQL
└── automated backups
```

A candidate VPS discussed had:

- 4 vCPU
- 8 GB RAM
- 100 GB SSD
- 200 Mbit/s

No VPS deployment has happened yet.

---

## 6. Current online repository structure

```text
maktaba-pos/
├── apps/
│   ├── desktop/            # Existing offline Tauri app
│   ├── api/                # Fastify/PostgreSQL API
│   └── web/                # React/Vite PWA
├── packages/
│   ├── shared-types/
│   └── validation/
├── deploy/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   └── Caddyfile
├── docs/
├── package.json            # npm workspaces
├── README.md
└── IMPLEMENTATION_STATUS.md
```

The root workspace was added without replacing `apps/desktop`.

---

## 7. Online PostgreSQL foundation

Technology:

- PostgreSQL 17 Alpine
- Docker Compose
- Drizzle ORM
- Drizzle migrations

Initial migration:

```text
apps/api/drizzle/0000_rainy_cloak.sql
```

The initial schema contains 22 tables mirroring the important offline financial model.

Key domains include:

- app settings
- users
- sessions
- categories
- products
- price history
- customers
- customer credit ledger
- suppliers
- supplier payments
- registers
- denominations
- cash movements
- sales
- sale items
- stock movements
- purchases
- purchase items
- expenses
- returns
- return items
- audit logs

Database design includes:

- integer-centime money fields
- foreign keys
- checks
- indexes
- unique identifiers
- one-open-register-per-cashier partial unique constraint
- session storage
- idempotency support
- ledgers
- snapshots
- audit data

The migration was applied successfully.

### Local database details

Docker container:

```text
deploy-postgres-1
```

Port mapping:

```text
127.0.0.1:5433 -> container 5432
```

Database:

```text
maktaba
```

User:

```text
maktaba
```

Do not put the password or session pepper in this handoff or Git.

---

## 8. Online API foundation

Path:

```text
apps/api
```

Implemented routes:

```text
GET  /health
GET  /ready
GET  /api/bootstrap/status
POST /api/bootstrap/owner
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/change-password
GET  /api/dashboard
```

Authentication includes:

- Argon2 password hashes
- Random opaque session tokens
- SHA-256 token hashes strengthened with a server pepper
- HttpOnly cookies
- SameSite protection
- Secure cookies in production
- Database expiration/revocation
- Active-user validation
- Forced password-change enforcement
- Rate limiting
- Atomic owner bootstrap
- PostgreSQL advisory locking
- Central backend permissions
- Safe user DTOs

First-owner onboarding creates app settings and the first global admin atomically.

### Environment variables

Required values include:

```text
DATABASE_URL
SESSION_PEPPER
APP_ORIGIN
API_HOST
API_PORT
NODE_ENV
TRUST_PROXY
LOG_LEVEL
```

Local file:

```text
apps/api/.env
```

Important:

- `.env` must remain ignored by Git
- do not print secrets
- do not change `SESSION_PEPPER` casually
- production Docker/VPS variables must override local `.env`

The API environment-loading bug was fixed permanently. Root commands now load `apps/api/.env` independently of the current working directory without overriding already-defined process variables.

---

## 9. Online web/PWA foundation

Path:

```text
apps/web
```

Implemented:

- First-owner onboarding
- Login
- Mandatory password change
- Protected responsive layout
- Mobile sidebar
- Current user and role
- Logout
- Authenticated dashboard request
- API-unavailable state
- Unauthorized/forbidden/not-found states
- PWA manifest
- Generated service worker
- Update registration foundation

PWA rules:

- API requests are NetworkOnly
- financial mutations are not queued offline
- no claim that POS works offline
- service worker disabled in development
- production PWA update foundation retained

---

## 10. Online stabilization and performance work

Initial online issues included:

- Logout forced `Content-Type: application/json` with no body
- Fastify returned `FST_ERR_CTP_EMPTY_JSON_BODY`
- 401 and 429 responses were shown as generic internal errors
- Duplicate bootstrap/auth/dashboard requests under React StrictMode
- Service worker registered in development
- Environment variables did not load reliably
- Perceived loading felt heavy

A full stabilization pass was implemented.

### Fixes completed

- Bodyless idempotent logout
- Session revocation and cookie clearing
- Shared typed API client
- Safe JSON/empty-response parsing
- Normalized French API errors
- Network-error handling
- Retry-After handling
- Credentials included
- AbortSignal support
- Login by username and email
- Username/email normalization
- StrictMode-safe bootstrap/auth/dashboard loading
- Duplicate login/logout prevention
- Session-expiration handling
- Service workers disabled in development
- Lazy dashboard and PWA registration
- Permanent environment loading
- Authentication/session indexes
- One bounded PostgreSQL pool

### Performance measurements

After stabilization:

```text
Initial JS: 240.27 kB
Initial JS gzip: 77.46 kB
CSS: 1.86 kB
CSS gzip: 0.83 kB
Lazy dashboard: 0.67 kB / 0.44 kB gzip
Lazy PWA registration: 0.92 kB / 0.54 kB gzip
LCP: 162 ms
TTFB: 5 ms
CLS: 0.00
Median bootstrap: 5.35 ms
Median auth/me: 1.43 ms
```

Initial unauthenticated load now makes:

- exactly one bootstrap request
- exactly one auth/me request

Development service-worker registrations: zero.

### Stabilization verification

- TypeScript passed
- ESLint passed with zero warnings
- Production build passed
- 23 tests passed:
  - API/PostgreSQL integration: 7
  - Web: 13
  - Shared types: 1
  - Validation: 2
- Root migration command passed
- Migration applied to PostgreSQL Docker

The user manually reached the authenticated online dashboard and saw the API-connected state.

A manual re-test of real-owner login/logout after the stabilization patch is still recommended even though the equivalent integration tests passed.

---

## 11. Development startup race still pending

Current `npm run dev` can briefly show:

```text
ECONNREFUSED 127.0.0.1:3000
```

Cause:

- Vite starts first
- it requests `/api/bootstrap/status`
- API starts successfully a moment later

This is not a production or database-performance problem.

It was intentionally deferred to the beginning of Online Phase 2.

Required fix:

- start API first
- wait for `http://127.0.0.1:3000/health`
- start web afterward
- use `wait-on` or equivalent
- no fixed arbitrary sleep
- clean shutdown
- Windows compatibility

---

## 12. Current local commands

Run from:

```powershell
cd C:\laragon\www\maktaba-pos
```

Start PostgreSQL:

```powershell
npm run docker:up
```

Check it:

```powershell
docker compose -f deploy/docker-compose.dev.yml ps
```

Apply migrations:

```powershell
npm run db:migrate
```

Run API and web:

```powershell
npm run dev
```

Full checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Expected local addresses:

```text
Web: http://localhost:5173
API: http://127.0.0.1:3000
PostgreSQL: 127.0.0.1:5433
```

Health checks:

```powershell
curl.exe http://127.0.0.1:3000/health
curl.exe http://127.0.0.1:3000/ready
```

Stop development database:

```powershell
npm run docker:down
```

---

## 13. Online roadmap and current phase

### Phase 1 — Online foundation

**Status: complete and stabilized**

Included:

- PostgreSQL
- Fastify API
- Drizzle migrations
- Authentication
- Sessions
- Owner onboarding
- Protected PWA shell
- Docker/Caddy foundation
- Environment loading
- Error handling
- Performance stabilization

### Phase 2 — Categories/products/services/stock

**Status: next phase, not implemented yet**

Required scope:

- Fix dev startup race
- Categories
- Products
- Services
- Sequential internal barcodes
- Stable QR identifiers
- Stock
- Stock movements
- USB scanner buffering
- Permissions
- PostgreSQL integration tests
- Frontend tests

Do not implement camera scanning yet.

### Phase 3 — Register/POS/sales/customers/credit

**Status: pending**

Scope:

- Register opening and closing
- POS
- Cash sales
- Credit sales
- Partial cash/credit
- Customers
- Debt payments
- Transactional stock decrement
- Idempotency
- Receipts

This is the most important phase before real shop use.

### Phase 4 — Suppliers/purchases/expenses/returns

**Status: pending**

Scope:

- Suppliers
- Supplier debt
- Multi-line purchases
- Supplier payments
- Expenses and corrections
- Returns/refunds
- Credit-before-cash allocation

### Phase 5 — Employees/reports/exports/camera/printing

**Status: pending**

Scope:

- Online worker management
- Temporary password reset
- Forced password change
- Reports
- CSV
- Camera scanning
- Labels
- Complete print templates

### Phase 6 — SQLite to PostgreSQL migration

**Status: pending**

Scope:

- Export SQLite
- Transform/import
- Map relationships
- Verify products, stock, debts, suppliers, sales, returns, registers, and audits
- Freeze offline writes during migration
- Compare totals before and after

### Phase 7 — VPS deployment and go-live

**Status: pending**

Scope:

- Ubuntu VPS
- Production Docker Compose
- Caddy HTTPS
- Domain
- Firewall
- Private PostgreSQL
- Production secrets
- Backups
- Restore test
- Monitoring
- Migration deployment step
- Go-live checklist

---

## 14. Immediate instruction for the next AI

The next AI must implement **Online Phase 2 only**.

It must not:

- modify `apps/desktop`
- deploy yet
- implement POS yet
- add fake pages
- add dead navigation
- create another API client
- rely on frontend-only permissions
- share SQLite over the network
- fetch all products or stock movements at once

It should first fix the development startup race, then implement categories, products, services, concurrency-safe internal identifiers, stock, stock movements, USB scanner buffering, permissions, tests, and verification.

Suggested handoff instruction:

> Continue from `C:\laragon\www\maktaba-pos`. Read `README.md`, `IMPLEMENTATION_STATUS.md`, all `docs/ONLINE_*` files, the Drizzle schema/migrations, API auth and permission middleware, the typed web API client, and the offline desktop implementation only as a business-rule reference. Do not recreate the project, do not modify `apps/desktop`, do not deploy, and do not implement online POS yet. Implement Online Phase 2 end to end: fix the API/web startup race, categories, products, services, concurrency-safe internal barcodes and QR identifiers, stock, stock movements, USB scanner input, API permissions, PostgreSQL integration tests, frontend tests, production build, and local smoke verification.

---

## 15. Critical business rules to preserve

### Money

- Store as integer centimes
- Never store database money as floating point

### Product types

- `physical_product`
- `service`

Services do not track stock.

### Internal barcode

Format:

```text
MKT-000001
MKT-000002
MKT-000003
```

Requirements:

- atomic PostgreSQL sequence handling
- do not generate by counting products
- concurrency safe
- do not change on edit
- prefix changes do not rewrite existing identifiers

### QR identifier

Stable product identifier only.

Never include:

- price
- stock
- credentials
- sessions
- customer data
- secrets

### Stock

Every stock change must:

- use a PostgreSQL transaction
- lock or atomically update the product
- validate stock after locking
- prevent negative stock
- create stock movement
- create audit log
- roll back completely on failure

### Roles

- `global_admin`
- `manager`
- `cashier`
- `stock_worker`

Permissions must be enforced in the API. Hiding buttons is not security.

### Sessions

- Opaque random token
- Token hash stored in PostgreSQL
- HttpOnly cookie
- SameSite protection
- Secure in production
- Expiring and revocable
- No session token in localStorage

### PWA

- API/financial operations remain NetworkOnly
- no financial offline queue
- no claim of offline POS support

---

## 16. Current online limitations

The online version currently does not yet contain:

- category management
- products
- services
- stock
- stock movements
- business scanner integration
- POS
- sales
- customers/debts
- suppliers
- purchases
- expenses
- returns
- reports
- CSV exports
- printing suite
- camera scanner
- offline/online synchronization
- SQLite migration script
- VPS deployment
- production backup system

The development startup race is also still pending.

---

## 17. Security and repository rules

Never commit:

- `apps/api/.env`
- database passwords
- `SESSION_PEPPER`
- production secrets
- dumps
- backups

Do not log secrets.

Production PostgreSQL must not be exposed publicly.

Only Caddy should expose the web/API through HTTPS.

Always read:

```text
README.md
IMPLEMENTATION_STATUS.md
```

before claiming completion.

Recommended Git checkpoint before Phase 2:

```powershell
cd C:\laragon\www\maktaba-pos
git status
git add .
git commit -m "Stabilize online foundation and authentication"
git branch --show-current
```

Do not commit `.env`.

---

## 18. Key documentation files

Existing or expected documentation includes:

```text
README.md
IMPLEMENTATION_STATUS.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/AUTHENTICATION.md
docs/POS_WORKFLOW.md
docs/STOCK_SYSTEM.md
docs/CREDIT_SYSTEM.md
docs/PURCHASES.md
docs/RETURNS.md
docs/BACKUP_RESTORE.md
docs/PRINTING.md
docs/TROUBLESHOOTING.md
docs/WORKERS.md
docs/REPORTS.md
docs/CSV_EXPORTS.md
docs/ONLINE_ARCHITECTURE.md
docs/ONLINE_DATABASE.md
docs/ONLINE_AUTHENTICATION.md
docs/ONLINE_DEPLOYMENT.md
docs/OFFLINE_ONLINE_BOUNDARY.md
docs/POSTGRES_MIGRATIONS.md
docs/ONLINE_PERFORMANCE.md
```

Phase 2 should add or update:

```text
docs/ONLINE_PRODUCTS.md
docs/ONLINE_STOCK.md
```

---

## 19. Phase 2 completion definition

Online Phase 2 is complete only when:

- Root `npm run dev` waits for API health before web starts
- Category API and UI work
- Product API and UI work
- Service products work
- Internal barcode generation is concurrency safe
- QR identifiers are stable
- Product editing preserves identifiers
- Stock adjustment is transactional
- Negative stock is rejected
- Services reject stock changes
- Stock movement history works
- USB scanner buffer works
- Duplicate scans are prevented
- API permissions work
- Restricted roles receive 403
- Server-side pagination works
- Search and filters work
- Data persists after restart
- TypeScript passes
- ESLint passes with zero warnings
- Tests pass
- Production build passes
- Local smoke test passes
- `apps/desktop` remains unchanged
- No deployment occurs
- Online POS is not implemented prematurely
