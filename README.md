# 3% Club — WhatsApp qualification filter

Upload a list of numbers, run them through a funnel you build yourself, and
export the ones who ask to be contacted. The CRM team works outside this
system; this is the filter that feeds it.

Spec: `docs/superpowers/specs/2026-09-04-whatsapp-qualification-filter-design.md`

## The flow

1. **Funnels** — build a sequence: message, question, wait, mark qualified,
   stop. A question also says how many days to wait for a reply and where a
   silent number goes; a stop says what the number is left as (Not interested,
   No response). A funnel cannot go live without a Mark qualified step, because
   one that cannot qualify anyone produces nothing.
2. **Batches** — paste or load a list of numbers, review what was parsed, then
   run it through a live funnel. The funnel version is frozen onto the batch,
   so later edits cannot change what a running batch sends.
3. **Qualified** — the numbers that said yes. Export to CSV; each export
   stamps the rows so the next "new only" export never repeats them.

## Screens

| Screen | What it is for |
|---|---|
| Batches | What is running, the upload flow, and where each number has reached |
| Qualified | The output list and its CSV export |
| Funnels | The funnel library and builder |
| Templates | Approved message templates |
| Settings | The emergency stop, and the words that opt a number out |

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Web + API | Next.js 16.3.4 (App Router, Turbopack), React 19.2 | Server Actions and Route Handlers; one deployable. |
| Database | PostgreSQL 18 via Prisma 7 | 15 models. Supabase in development. |
| Auth | Auth.js v5, credentials + JWT session | Two roles: Admin and Viewer. |
| Styling | Tailwind CSS 4, semantic tokens | Tokens in `src/app/globals.css`. |
| Durable timers | `automation_runs.next_action_at` + worker | See "Deviations" below. |

## Setup

```bash
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npm install
npm run db:deploy             # applies migrations
npm run db:seed               # admin user, settings, starter funnel
                              # SEED_DEMO=true also loads 102 demo numbers
npm run dev
```

Any Postgres works. `docker compose up -d` starts a local one; with Docker
unavailable, `npx prisma dev` runs an embedded Postgres and prints a TCP URL
for `DATABASE_URL`.

Seeded admin: `admin@3percent.local` / `ChangeMe123!` (override with
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

### Driving the timers

Waits and no-response branches only fire while something ticks the worker.
Point a scheduler at it:

```bash
curl -X POST -H "Authorization: Bearer $AUTOMATION_TICK_SECRET" \
     http://localhost:3000/api/automation/tick
```

The same call also enrols the next slice of each running batch. Ticking more
often than the shortest wait is harmless: claiming is transactional and every
effect is idempotent.

## Deviations from the source documentation

Doc 08 marks technical content as *recommendation, not business rule*. Two
recommendations were not adopted:

1. **NestJS** — the API surface is Next.js Server Actions and Route Handlers.
   Same modular boundaries (`src/lib`, per-module `actions.ts`), one process to
   deploy and monitor instead of two.
2. **Temporal** — automation waits are stored as `automation_runs.next_action_at`
   and claimed by a worker polling the `(state, next_action_at)` index. This
   satisfies the requirements (exact waits, pause/resume, restart-safety via
   `automation_events.idempotency_key`) without a second cluster.

**Not production ready.** See `PRODUCTION.md` for the blockers.
`PROGRESS.md` has the full build record.

## Checks

```bash
npm run typecheck        # next typegen + tsc --noEmit
npm run test             # node:test via tsx
npm run build
npx eslint src prisma --max-warnings=0
npx prisma validate
```
