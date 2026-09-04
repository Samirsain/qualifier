# 3% Club — Customer Dashboard

Implementation of `3_Percent_Club_Complete_Documentation_Package`.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Web + API | Next.js 16.3.4 (App Router, Turbopack), React 19.2 | Doc 08 recommends Next.js. Server Actions replace a separate NestJS service — one deployable instead of two. |
| Database | PostgreSQL 18 via Prisma 7 | Doc 09 schema, all 37 entities. |
| Auth | Auth.js v5, credentials + JWT session | Identity provider and MFA are GAP-025 (TBD), so this is swappable. |
| Styling | Tailwind CSS 4, semantic tokens | Doc 05 tokens in `src/app/globals.css`. Brand hex values are a pending design approval. |
| Durable timers | `automation_runs.next_action_at` + worker | See "Deviations" below. |

## Setup

```bash
docker compose up -d          # or point DATABASE_URL at any Postgres
cp .env.example .env          # then set AUTH_SECRET
npm install
npm run db:migrate            # creates the schema
npm run db:seed               # roles, permissions, lead stages, sources, admin
npm run dev
```

Seeded admin: `admin@3percent.local` / `ChangeMe123!` (override with
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

## Deviations from the documentation

Doc 08 marks technical content as *recommendation, not business rule*. Two
recommendations were not adopted:

1. **NestJS** — the API surface is Next.js Server Actions and Route Handlers.
   Same modular boundaries (`src/lib`, per-module `actions.ts`), one process to
   deploy and monitor instead of two. Business rules stay out of components.
2. **Temporal** — automation waits are stored as `automation_runs.next_action_at`
   and claimed by a worker polling the `(state, next_action_at)` index. This
   satisfies the source requirements (exact 1-day revision wait, configured
   no-response wait, pause/resume, restart-safety via `automation_events.
   idempotency_key`) without a second cluster. If measured throughput or
   workflow complexity outgrows it, the run/step/event tables map onto Temporal
   workflows without a schema change.

## Status against the development plan

| Phase | State |
|---|---|
| DEV-001 Project foundation | Done — app, schema, migrations, env, build |
| DEV-002 Authentication and roles | Done — Auth.js, 4 roles, permission matrix, API+UI guards, audited login |
| DEV-003 Customers, sources, tags, 360 | Done — list, filters, create, profile, 360 timeline, assignment history |
| DEV-004 WhatsApp Inbox and message integration | Done — provider adapter (mock + Meta Cloud API), signed webhook, idempotent ingest, three-pane inbox, reply/template send, close/reopen |
| DEV-005 Templates and FAQ | Done — template library, editor with preview, duplicate/archive, usage counts; FAQ CRUD by category with search |
| DEV-006 Lead CRM and follow-ups | Done — ten-stage pipeline with counts, stage moves always written to history, follow-up today/upcoming/overdue/completed queues, complete/reschedule, call and meeting queues |
| DEV-007 Calls, meetings and staff assignment | Done — one creation service for staff and automations, ownership + reassignment with notifications, staff workload and profile |
| DEV-008 Automation engine foundation | Done — step runtime, durable timer worker with `SKIP LOCKED` claiming, event idempotency, validation, pause/resume/stop/pause-all |
| DEV-009 3% Club YES/NO and 1-day revision | Done — 25-step journey; the critical NO rule is structurally enforced and tested |
| DEV-010 No-response and additional types | Partial — the no-response path exists; its wait value is blocked on GAP-002 |
| DEV-011 Campaigns | Done — segment builder with shared preview/launch resolver, audience frozen at launch, mid-batch stop, per-customer delivery reporting |
| DEV-012 Staff scoring | Done — factors, versioned config, activation gate, explainable calculation. **No configuration is active**; the seed creates none (GAP-001) |
| DEV-013 Analytics and reports | Done — one shared metric layer for dashboard and reports, 31 defined KPIs, source performance cohort |
| DEV-014 Admin, settings and activity | Done — append-only activity log, settings for the open business decisions, emergency controls |
| DEV-015 Hardening and QA | Partial — security hardening done and tested; QA automation and the doc 15 §5 release gate are not |
| DEV-016 Deployment | Not started |

**Not production ready.** See `PRODUCTION.md` for the blockers, the five
defects found and fixed in the hardening pass, and the shortest path to a safe
launch.

See `PROGRESS.md` for the full build record: what maps to which document, the
deviations, and how each open business decision is handled.

## Checks

```bash
npm run typecheck        # next typegen + tsc --noEmit
npm run test             # node:test via tsx — 71 tests
npm run build
npx eslint src prisma
```

## Open business decisions in code

Fields whose taxonomy the business has not defined (`customer_status`,
`meeting_status`, `outcome`, `customer_type`) are stored as `String` and
surfaced in the UI as "Not defined" rather than given invented values. Timing
and policy decisions live in the `system_settings` table seeded to `null`:
no-response wait (GAP-002), reporting timezone (GAP-020), send window
(GAP-021), follow-up SLA (GAP-014), opt-out keywords (GAP-018).

No staff-scoring formula runs until a `staff_score_configs` row is approved and
activated (GAP-001). The activation gate refuses a configuration with unset
weights, a missing cap or target, no approval note, or one where every enabled
factor is a raw count — doc 13 §4 warns that last case favours larger
workloads. `PROGRESS.md` §10 lists the nine decisions needed.
