# Task Ledger — Application Context & Technical Reference

> **Purpose:** This document is the implementation-based reference for Task Ledger. It describes the current repository, its capabilities, technology choices, visual system, and operating model. It deliberately distinguishes code that is implemented from configuration or data-model support that may require a provider or deployment setup.

## 1. Product overview

Task Ledger is a web application for tracking operational assets and the work associated with them. Its core domains are:

- **Properties** — property records and associated compliance work.
- **Vehicles** — fleet records and vehicle-specific tasks such as insurance or other due items.
- **Assets** — machinery, equipment, or other assets with maintenance/compliance tasks.
- **Tax & legal tracker** — compliance containers and their dated child items.
- **Task actions** — general work/action registers with assignees, priority, status, and child tasks.
- **Calendar and dashboard** — a consolidated view of dated work, reminders, and operational statistics.
- **Documents** — uploads attached to supported entities, stored in S3-compatible AWS storage.
- **Users and settings** — local username/password accounts, administrator-controlled user management, and category configuration.

The product is organized as a TypeScript monorepo with a browser SPA, an Express API, and a shared package that owns the PostgreSQL schema, Zod validation, and cross-application types.

## 2. Repository structure

```text
Customer/
├── apps/
│   ├── frontend/                 # Vite + React single-page application
│   │   ├── src/
│   │   │   ├── pages/            # Route-level feature screens
│   │   │   ├── components/       # Feature and reusable UI components
│   │   │   ├── hooks/            # React Query-backed feature hooks
│   │   │   ├── lib/              # API client, routing guards, utilities
│   │   │   ├── assets/           # Images and static application assets
│   │   │   ├── App.tsx           # Providers and client-side route map
│   │   │   └── index.css         # Global styles, design tokens, print styles
│   │   ├── vite.config.ts        # Vite setup, aliases, API proxy
│   │   └── tailwind.config.ts    # Tailwind token bindings and extensions
│   └── backend/                  # Express API and background scheduling
│       ├── src/
│       │   ├── index.ts          # HTTP server, middleware, scheduler startup
│       │   ├── routes.ts         # Domain API endpoints
│       │   ├── auth.ts           # Sessions, Passport local auth, authorization
│       │   ├── storage.ts        # Database persistence implementation
│       │   ├── reminder-scheduler.ts
│       │   └── cron-run-reminders.ts
│       ├── migrations/           # Drizzle database migrations
│       ├── drizzle.config.ts     # PostgreSQL migration configuration
│       └── build.mjs             # Production server bundling
├── packages/
│   └── shared/                   # Shared domain contract
│       └── src/
│           ├── schema.ts         # Drizzle tables, types, and Zod schemas
│           └── recurrence-validation.ts
├── package.json                  # npm workspace scripts
└── package-lock.json             # Locked dependency graph
```

## 3. Technology stack

### Platform and language

| Area | Technology | Role |
| --- | --- | --- |
| Monorepo | npm workspaces | Coordinates `apps/*` and `packages/*` packages. |
| Language | TypeScript 5.6 | Used by the frontend, backend, and shared domain package. |
| Runtime | Node.js | Runs the API, build scripts, and development tools. |
| Module format | ECMAScript modules | All application packages are configured with `"type": "module"`. |

### Frontend

| Technology | Usage |
| --- | --- |
| React 18 | Component model and client rendering. |
| Vite 5 | Local development server and production SPA build. |
| Wouter | Lightweight client-side routing used by `App.tsx`. `react-router-dom` is installed but is not the route system used by the application entry point. |
| TanStack React Query 5 | Server-state cache, queries, mutations, and cache invalidation. |
| React Hook Form + Zod | Form state and runtime validation. |
| Tailwind CSS 3 | Utility styling, bound to CSS variables for the application theme. |
| Radix UI | Accessible primitive components for dialogs, menus, popovers, toasts, and controls. |
| CVA, clsx, tailwind-merge | Variant-based component styling and safe class composition. |
| Lucide React / React Icons | Iconography. |
| Framer Motion | UI animation where used by feature components. |
| Recharts | Dashboard/chart rendering. |
| Uppy + AWS S3 plugins | Browser-side document upload workflow. |
| PDF.js | In-app PDF rendering/preview support. |

### Backend and integrations

| Technology | Usage |
| --- | --- |
| Express 4 | JSON HTTP API and middleware pipeline. |
| PostgreSQL | Primary relational data store. |
| Drizzle ORM + Drizzle Kit | Typed database access, schema definition, and migrations. |
| Zod + drizzle-zod | Request/domain validation and schema-derived insert contracts. |
| express-session + connect-pg-simple | Server-managed, PostgreSQL-backed login sessions. |
| Passport + passport-local | Username/password authentication strategy. |
| Node `crypto.scrypt` | Password hashing with a random salt and timing-safe verification. |
| AWS SDK for JavaScript (S3) | Object storage and signed upload/download URLs for documents. |
| Nodemailer / Resend | Email delivery abstraction; deployment selects the configured provider. |
| node-cron | Starts the reminder scheduler every minute when the API starts. |
| `ws` | Included for WebSocket capability; no application-wide real-time endpoint is established by the server entry point. |
| esbuild | Bundles the backend production artifact. |

## 4. Architecture and request flow

```text
Browser
  └─ React + Vite SPA (port 5173 in development)
       ├─ Wouter route + ProtectedRoute
       ├─ React Query cache
       └─ fetch(..., { credentials: "include" })
              │
              │ /api proxy during local development
              ▼
Express API (port 5000 by default)
  ├─ CORS restricted to FRONTEND_URL, with credentials
  ├─ Express session + Passport local authentication
  ├─ Route handlers and Zod validation
  ├─ Storage/repository layer
  └─ Reminder scheduler (each minute)
       │
       ├─ PostgreSQL through Drizzle
       ├─ AWS S3 document objects and signed URLs
       └─ Resend or SMTP email provider
```

### Local development topology

- The frontend dev server listens on `http://localhost:5173`.
- Vite proxies `/api` requests to `http://localhost:5000`.
- The backend defaults to `127.0.0.1:5000` outside production and uses `0.0.0.0` in production.
- The frontend API helper always includes session cookies, so browser/API origins must match the configured CORS and cookie requirements.
- The frontend template includes `VITE_API_URL`, but the current API helpers use relative `/api/...` paths directly. A production deployment therefore needs a same-origin `/api` reverse proxy (or a corresponding client API-base-URL implementation).

## 5. Frontend organization

### Route map

All routes except `/auth` are protected by the authentication guard.

| Path | Screen | Purpose |
| --- | --- | --- |
| `/` | Dashboard | Summary statistics, due dates, and cross-domain operational overview. |
| `/vehicles` | Vehicles | Vehicle inventory and vehicle tasks. |
| `/assets` | Assets | Asset inventory and asset tasks. |
| `/properties` | Properties | Property management and related content. |
| `/tax-tracker` | Tax tracker | Tax/legal compliance records and due items. |
| `/task-actions` | Task actions | General action registers and child work items. |
| `/settings` | Settings | Administrative/settings workflows, including user/category management. |
| `/missed-reminders` | Missed reminders inbox | Outstanding/missed reminder workflow. |
| `/occurrences/:entityType/:entityId/timeline` | Occurrence timeline | Per-entity reminder/task occurrence history. |
| `/auth` | Authentication | Login and, when allowed by backend configuration, account registration. |

### Client state and API behavior

- `QueryClientProvider` wraps the application and supplies React Query to pages and feature hooks.
- Requests use `fetch`, JSON payloads, and `credentials: "include"` to transport the server session cookie.
- Default queries do not refetch on window focus, do not automatically retry, and remain fresh until explicitly invalidated (`staleTime: Infinity`).
- `AuthProvider` reads `/api/user`, exposes login/logout/registration mutations, and clears the query cache on logout.
- Toasts and tooltips are application-level providers; feature UI is composed from reusable primitives in `components/ui`.

### Main frontend conventions

- `@/` resolves to `apps/frontend/src`.
- `@shared/` resolves to `packages/shared/src`.
- Route-level views live under `src/pages`.
- Cross-feature view pieces are grouped by domain, for example `components/calendar`, `components/dashboard`, `components/documents`, and `components/forms`.
- Shared schemas and select/insert TypeScript types are imported from `@shared/schema`, avoiding duplicate client and server contracts.

## 6. Backend organization

### API concerns

| Concern | Implementation |
| --- | --- |
| Server setup | `src/index.ts` configures CORS, JSON parsing, request logging, error handling, route registration, and cron startup. |
| Authentication | `src/auth.ts` configures Passport local authentication, session serialization, account registration, and admin user management. |
| Authorization | `requireAuth` protects operational endpoints; `requireAdmin` protects user-management endpoints. |
| Domain API | `src/routes.ts` exposes the domain CRUD, task, calendar, document, dashboard, and reminder endpoints. |
| Persistence | `src/storage.ts` encapsulates database reads and writes. |
| Scheduling | `src/reminder-scheduler.ts` is invoked every minute; `cron-run-reminders.ts` supports a standalone invocation. |
| Validation | Shared Zod schemas validate domain inputs and recurrence/reminder constraints. |

### API domain groups

The API is versionless and served below `/api`. Important endpoint groups include:

- **Health:** `/api/health`
- **Authentication:** `/api/login`, `/api/logout`, `/api/user`, and optional `/api/register`
- **Admin users:** `/api/users`
- **Properties:** `/api/properties`
- **Tax/legal compliance:** `/api/tax-legal-compliances` and their `/items`
- **Vehicles and vehicle items:** `/api/vehicles`, `/api/vehicle-items`
- **Assets and asset tasks:** `/api/assets`, `/api/asset-items`, and `/api/assets/:assetId/tasks`
- **Task actions and child tasks:** `/api/task-actions`, `/api/task-action-items`, and nested task-action routes
- **Calendar and aggregate work:** `/api/calendar-events`, `/api/calendar/items`, `/api/tasks`, `/api/tasks/complete`
- **Dashboard:** `/api/dashboard/stats`, `/api/dashboard/upcoming-due-dates`
- **Reminder operations:** `/api/reminders/missed`, task occurrence routes, and admin reminder/email test routes
- **Documents:** upload, create/list link, signed URL, preview URL, and delete endpoints under `/api/task-ledger-*`
- **HR data:** `/api/hr-employees` (read endpoint)

The category and task-occurrence status APIs are defined as Express sub-routers in `src/routes/`; the remaining API surface is principally organized in the large `src/routes.ts` module.

## 7. Data model and business domains

The canonical Drizzle schema is `packages/shared/src/schema.ts`. It exports database tables, inferred select/insert types, and Zod schemas used by both applications.

| Data area | Core tables | Notes |
| --- | --- | --- |
| Identity | `taskledger_users` | Users have a username, email, password hash, role, active status, permissions, and optional organization ID. |
| HR | `hr_employees`, `hr_employee_photos` | Employee records include employment, contact, statutory, bank, and photo metadata. |
| Properties | `properties` | Physical property data, tax/EB metadata, and custom fields. |
| Tax/legal | `tax_legal_compliances`, `tax_legal_items`, `tax_tracker_categories` | Parent compliance record + due-dated items; categories are reusable across modules. |
| Vehicles | `vehicles`, `vehicle_items` | Vehicle records plus recurring/remindable vehicle work. |
| Assets | `assets`, `asset_items` | Asset records plus recurring/remindable asset work. |
| Action management | `task_actions`, `task_action_items` | General action items, assignees, priorities, statuses, and child tasks. |
| Calendar | `calendar_events` | Ad hoc dated events and their notification preferences. |
| Documents | `task_ledger_documents`, `task_ledger_document_links` | Normalized document metadata and entity attachment links. Stable bucket keys are stored—not expiring signed URLs. |
| Reminders | `occurrence_reminders` | Generated reminder/task occurrences, delivery state, retry metadata, and completion notes. |

The persistence layer also uses raw SQL tables outside the Drizzle table declarations: `task_occurrence_events` for task completion/status history, `scheduler_locks` for reminder-processing leases, and `session` for PostgreSQL session storage.

### Recurrence, reminders, and notifications

Vehicle items, asset items, task actions, task-action items, tax/legal items, and calendar events carry variants of:

- due date/time and completion status;
- recurrence configuration and the next due date;
- multiple reminder times or custom reminder dates;
- notification channel and recipient preferences;
- completion notes and timestamps.

The database schema supports `email`, `whatsapp`, and `sms` channel preferences. The checked-in environment template configures email delivery only (Resend or SMTP); a production WhatsApp/SMS transport should not be assumed without confirming a corresponding provider implementation and configuration.

## 8. Authentication, authorization, and tenancy

### Authentication model

- Authentication is local username/password login using Passport's local strategy.
- Passwords are hashed with Node.js `scrypt`, using a unique 16-byte random salt per password.
- Password verification uses `timingSafeEqual`.
- Sessions are stored through the configured storage/session store and delivered in an HTTP-only cookie.
- Session lifetime is 24 hours.
- The frontend checks the current session through `/api/user`; protected routes redirect unauthenticated users.

### Authorization and configuration

- The `admin` role controls user-management API routes.
- Operational routes require an authenticated session.
- The current `/api/admin/trigger-reminders`, `/api/admin/test-email`, and `/api/admin/email-status` routes require authentication but are not protected by `requireAdmin`. They should be reviewed before treating them as administrator-only operations.
- Public registration exists only when `ALLOW_PUBLIC_REGISTRATION=true`.
- `SINGLE_TENANT_MODE` determines the organization identity behavior on login/registration. The application schema includes `orgId` fields for relevant user/document records, indicating support for organization scoping.
- `SESSION_SECRET` is mandatory for backend startup; it must be a strong, unique secret in every deployed environment.
- Cookie security is controlled by `COOKIE_SECURE` or inferred from `NODE_ENV`. HTTPS is required when secure cookies are enabled.

## 9. Brand, colors, and UI theme

### Design direction

The interface uses a light, soft, high-radius operational-dashboard style:

- warm neutral application background;
- white elevated cards and panels;
- teal as the primary action/status color;
- amber/yellow as the secondary or attention color;
- a near-black navy used for dark panels and high-contrast actions;
- Montserrat as the primary typeface;
- rounded, pill-shaped controls and large rounded card surfaces;
- soft layered shadows rather than strong borders.

The source comments call this visual treatment “Wander App,” while the codebase, package names, email defaults, and product domains identify the application as **Task Ledger**. Treat “Wander” as a legacy design-token/comment label rather than the product name unless product stakeholders specify otherwise.

### Core palette

| Semantic token | Hex | Intended use |
| --- | --- | --- |
| Page dark | `#01021C` | Dark cards/shells, dark button background, overlays/shadows. |
| Shell / app background | `#D5CFD0` | Primary page background. |
| Soft card / muted | `#F2F2F1` | Muted surfaces and hover backgrounds. |
| Strong card | `#FFFFFF` | Cards, popovers, sidebar, and modal surfaces. |
| Primary teal | `#058A77` | Primary button, success, focus ring, sidebar primary, chart 1. |
| Primary teal hover | `#2F6D59` | Primary button hover and chart 3. |
| Deep teal | `#17483F` | Dark-button hover. |
| Secondary amber | `#FABF50` | Secondary/accent button, warning, chart 2. |
| Secondary amber hover | `#F5A823` | Secondary-button hover. |
| Main text | `#010100` | Default foreground text. |
| Muted text | `#7D6B75` | Secondary content and chart 4. |
| Secondary text | `#AE999F` | Low-emphasis content and chart 5. |
| Soft border | `#C1B9BC` | Standard border and sidebar border. |
| Input surface | `#EEECEA` | Inputs, textareas, selects, and comboboxes. |
| Destructive | `#EF4444` | Error/destructive actions. |

### Theme token mapping

The theme is defined in `apps/frontend/src/index.css` and exposed to Tailwind via `apps/frontend/tailwind.config.ts`.

| Tailwind semantic class family | CSS variable | Value |
| --- | --- | --- |
| `bg-background` / `text-foreground` | `--background` / `--foreground` | `#D5CFD0` / `#010100` |
| `bg-primary` | `--primary` | `#058A77` |
| `bg-secondary`, `bg-accent` | `--secondary`, `--accent` | `#FABF50` |
| `bg-muted` | `--muted` | `#F2F2F1` |
| `bg-card`, `bg-popover` | `--card`, `--popover` | `#FFFFFF` |
| `border-border` | `--border` | `#C1B9BC` |
| `bg-destructive` | `--destructive` | `#EF4444` |

Tailwind is configured for class-based dark mode, but the current global token set is a light theme with intentional dark components; there is no separate `.dark` token override in the global stylesheet. Adding true dark-mode behavior requires defining and testing a corresponding override palette.

### Typography, shape, and elevation

| Element | Specification |
| --- | --- |
| Primary typeface | Montserrat (400, 500, 600, 700, 800) loaded from Google Fonts. |
| Fallback font stack | System sans-serif (`-apple-system`, BlinkMacSystemFont, Segoe UI, sans-serif). |
| Base type | Responsive `text-sm` on small screens and `text-base` from the small breakpoint. |
| Standard radius | 24px (`--radius`). |
| Shell / dark card radius | 32px (`--radius-shell`). |
| Pill radius | `9999px`. |
| Standard card shadow | Soft navy-tinted elevation; hover uses a deeper shadow. |
| Button behavior | 200ms transitions, bold labels, 12px × 24px padding, pill radius. |

### Reusable visual treatments

- `.btn-primary`: teal, white text, bold pill button.
- `.btn-secondary`: amber, dark text, bold pill button.
- `.btn-dark`: near-black navy, white text, bold pill button.
- `.btn-outline`: white card surface with a soft border.
- `.card-wander-sm`: white, 24px radius, subtle elevation.
- `.card-dark`: dark navy, 32px radius, white text.
- `.badge-teal`, `.badge-yellow`, `.badge-dark`: compact pill status labels.
- The calendar has its own modern white/slate/indigo visual sub-theme, including indigo today highlighting (`#2563EB`) and an A4-focused print stylesheet.

## 10. Build, run, and validation commands

Run commands from the repository root after installing dependencies:

```bash
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts backend and frontend development servers. |
| `npm run dev:frontend` | Starts the Vite frontend only. |
| `npm run dev:backend` | Starts the Express backend only. |
| `npm run build:shared` | Builds the shared domain package. |
| `npm run build:frontend` | Produces the Vite frontend build. |
| `npm run build:backend` | Bundles the backend production output. |
| `npm run build:all` | Builds shared package, frontend, then backend. |
| `npm run typecheck` | Type-checks shared, backend, and frontend packages. |
| `npm run db:push` | Applies the Drizzle schema to the configured database. |
| `npm run cron:process-reminders -w apps/backend` | Runs the reminder-processing entry point manually. |

## 11. Environment configuration

Create `apps/backend/.env` from `apps/backend/.env.example`. Do not commit real secrets or production connection strings.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | No | Runtime mode; affects binding and cookie defaults. |
| `PORT` | No | Backend listening port; defaults to `5000`. |
| `SESSION_SECRET` | Yes | Cryptographic secret for session signing. |
| `DATABASE_URL` | Yes | PostgreSQL connection URL. |
| `FRONTEND_URL` | Yes for deployed CORS | Allowed browser origin; defaults to local Vite URL. |
| `APP_BASE_URL` | Deployment-dependent | Public backend base URL used by application integrations. |
| `SINGLE_TENANT_MODE` | No | Controls organization identity behavior. |
| `ALLOW_PUBLIC_REGISTRATION` | No | Enables self-service registration when `true`. |
| `S3_DOCUMENT_BUCKET` | Required for document storage | AWS S3 bucket used for uploaded documents. |
| `AWS_REGION` | Required for AWS S3 | AWS region for S3 operations. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Depends on AWS credential source | Local/non-role AWS credentials; production should prefer IAM roles. |
| `EMAIL_PROVIDER` | Required for email delivery | Selects `resend` or `smtp`. |
| `RESEND_API_KEY` | Required for Resend | API key for Resend email delivery. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Required for SMTP | SMTP relay configuration. |
| `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Recommended | Sender identity for email. |
| `COOKIE_SECURE` | No | Explicit secure-cookie override. |
| `MISSED_REMINDER_MAX_ATTEMPTS`, `MISSED_REMINDER_RETRY_INTERVAL_MINUTES`, `MISSED_REMINDER_RETRY_BATCH_SIZE`, `MISSED_REMINDER_RETRY_CRON` | No | Controls missed-reminder delivery retries. |
| `SKIP_STORAGE_INIT` | No | Skips database initialization for test/utility scenarios. |

`drizzle.config.ts` automatically recognizes local connection strings and otherwise adds SSL connection options for remote PostgreSQL/RDS connections that do not already include an SSL mode.

## 12. Deployment and operations notes

- Build the shared package before the applications: `npm run build:all` follows this order.
- The production backend starts from `apps/backend/dist/index.js`.
- Serve the frontend's generated `apps/frontend/dist` assets from a static host/CDN or an appropriate web server.
- Deploy the API behind HTTPS and set `FRONTEND_URL`, `APP_BASE_URL`, `COOKIE_SECURE`, and `SESSION_SECRET` correctly.
- Provide PostgreSQL, S3 access, and the selected email provider before enabling document/reminder workflows.
- The reminder scheduler is embedded in the web process and runs once per minute. In a horizontally scaled deployment, coordinate scheduler ownership to avoid duplicate execution unless the reminder engine’s database constraints and operational design are explicitly verified for multi-instance execution.
- The reminder engine maintains a PostgreSQL scheduler lease to avoid overlapping runs and can also be invoked by the standalone cron command.
- Use `/api/health` as a basic liveness endpoint.

### Testing and maintenance

- No automated test runner or `*.test.*`/`*.spec.*` suite is currently defined in the application workspaces.
- The repository does include operational/manual helper scripts under `apps/backend/scripts`, including migration, object-storage cleanup, reminder verification, and recurrence/occurrence validation utilities. Validate their paths and assumptions before using them in automation.

## 13. Current implementation boundaries

These are useful constraints for planning:

- User login is session-based, not JWT-based.
- The application currently uses Wouter for active routing; installed packages alone do not establish an architectural choice.
- The frontend has no checked-in deployment configuration (such as Docker, Vercel, Netlify, or CI configuration), and the backend does not serve the frontend build itself.
- Notification preferences include email, WhatsApp, and SMS data, but the tracked configuration documents only email provider setup.
- The schema includes multi-tenant fields, but tenancy behavior should be tested per route before claiming full tenant isolation across every domain table.
- Class-based dark-mode support is enabled in Tailwind configuration, but a complete alternate dark palette is not defined in the global style tokens.
- Calendar printing has dedicated A4 landscape/portrait CSS rules and should be regression-tested in target browsers/printers when altered.

## 14. Key source-of-truth files

| Topic | File |
| --- | --- |
| Workspace scripts | `package.json` |
| Frontend dependencies and scripts | `apps/frontend/package.json` |
| Frontend route map | `apps/frontend/src/App.tsx` |
| Client API/query behavior | `apps/frontend/src/lib/queryClient.ts` |
| Authentication client state | `apps/frontend/src/hooks/use-auth.tsx` |
| Visual tokens and global/print styles | `apps/frontend/src/index.css` |
| Tailwind semantic token configuration | `apps/frontend/tailwind.config.ts` |
| Vite dev server and API proxy | `apps/frontend/vite.config.ts` |
| Backend dependencies and scripts | `apps/backend/package.json` |
| Backend server lifecycle | `apps/backend/src/index.ts` |
| Authentication and roles | `apps/backend/src/auth.ts` |
| Domain endpoints | `apps/backend/src/routes.ts` |
| Persistence implementation | `apps/backend/src/storage.ts` |
| Database/migration configuration | `apps/backend/drizzle.config.ts` |
| Shared schema and domain validation | `packages/shared/src/schema.ts` |
| Environment variable template | `apps/backend/.env.example` |
| Frontend environment template | `apps/frontend/.env.example` |

