# 3% Club — Build Progress Record

Living record of what has been implemented against
`3_Percent_Club_Complete_Documentation_Package`. Updated as each phase of
`14_3_Percent_Club_Development_Plan.md` completes.

- **Project root:** `C:\Users\Sai\Desktop\auto\3percent-club`
- **Docs root:** `C:\Users\Sai\Desktop\auto\3_Percent_Club_Complete_Documentation_Package`
- **Last updated:** 2026-09-04

---

## 1. Phase status

| Phase | Scope | State |
| --- | --- | --- |
| DEV-001 | Project foundation | **Done** |
| DEV-002 | Authentication and roles | **Done** |
| DEV-003 | Customers, sources, tags, Customer 360 | **Done** |
| DEV-004 | WhatsApp Inbox and message integration | **Done** |
| DEV-005 | Templates and FAQ | **Done** |
| DEV-006 | Lead CRM and follow-ups | **Done** |
| DEV-007 | Calls, meetings and staff assignment | **Done** |
| DEV-008 | Automation engine foundation | **Done** |
| DEV-009 | 3% Club YES/NO and 1-day revision | **Done** |
| DEV-010 | No-response and additional automation types | Partial — the no-response path is built into the journey; the wait value is blocked on GAP-002 |
| DEV-011 | Campaigns | **Done** |
| DEV-012 | Staff scoring | **Done** - framework built, no configuration active (GAP-001) |
| DEV-013 | Analytics and reports | **Done** |
| DEV-014 | Admin, settings and activity | **Done** |
| DEV-015 | Hardening and QA | Partial — security hardening done; QA automation and the doc 15 §5 gate are not |
| DEV-016 | Deployment and production launch | Not started |

Source rollout alignment (doc 14 §3): **Phases 1 (Customer & Inbox), 2 (3% Club
Automation), 3 (Campaigns & Staff) and 4 (Analytics) are complete.** What
remains is DEV-014 (admin, settings, activity views), DEV-015 (hardening and
QA) and DEV-016 (deployment).

---

## 2. Stack as built

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Web + API | Next.js App Router, Turbopack | 16.3.4 | Doc 08 recommends Next.js. Latest stable, as requested. |
| UI | React | 19.2.8 | Ships with Next 16. |
| Styling | Tailwind CSS | 4.3.3 | Semantic tokens from doc 05, no hard-coded brand hex. |
| ORM | Prisma | 7.10.0 | Driver adapter (`@prisma/adapter-pg`). Generated client in `src/generated/prisma`. |
| Database | PostgreSQL | 18 | Doc 08 / doc 09. **Not yet provisioned — Supabase planned.** |
| Auth | Auth.js (next-auth) | 5.0.0-beta.32 | JWT sessions, credentials provider. Swappable — GAP-025 open. |
| Validation | Zod | 4.5.4 | Security §9 input validation at every trust boundary. |
| Tests | `node:test` via `tsx` | — | No framework; smallest thing that fails if the logic breaks. |

### Next.js 16 breaking changes accounted for

- `params` / `searchParams` / `cookies()` are async only — every page awaits them.
- `middleware.ts` → `proxy.ts`, exported function named `proxy`, nodejs runtime.
- `next lint` removed — ESLint runs directly.
- `PageProps` / `LayoutProps` come from `next typegen`, wired into `npm run typecheck`.

---

## 3. What exists, by document

### Doc 09 — Database Architecture → `prisma/schema.prisma`

All **37 entities** implemented with the recommended fields, FKs, unique
constraints and the indexing priorities from §5.

`users` `roles` `permissions` `user_roles` `role_permissions` `staff_profiles`
`customers` `sources` `tags` `customer_tags` `conversations` `messages`
`templates` `template_usages` `faqs` `campaigns` `campaign_audiences`
`campaign_deliveries` `automations` `automation_steps` `automation_runs`
`automation_events` `customer_responses` `lead_stages` `leads`
`lead_stage_history` `follow_ups` `calls` `meetings` `staff_assignments`
`staff_score_configs` `staff_scores` `notifications` `activity_logs`
`report_definitions`

Plus one addition not in doc 09: **`system_settings`** — a keyed store for the
emergency pause-all control (BR-39) and for every timing/policy value that is
still a TBD business decision. This keeps unresolved decisions out of code and
out of migrations.

Enums are declared **only** where the business source defines a closed list:
`InterestStatus` (9), `CampaignStatus` (7), `AutomationStatus` (4),
`CallStatus` (6), `RoleCode` (4). Everything the source leaves open stays
`String` — see §6 below.

### Doc 11 — Security → `src/lib/rbac.ts`, `src/lib/session.ts`, `src/auth.ts`

- 4 roles: Admin, Manager, CRM / Sales Staff, Viewer.
- ~45 permissions in `module:action` form, matching the §3 examples.
- Permission matrix follows §4 exactly. Every row the doc marks TBD
  (staff campaign/automation management, manager emergency controls, manager
  permission admin) **defaults to deny**, per §1 "default to deny".
- `requirePermission()` on every page, `assertPermission()` on every server
  action. Nav filtering is usability only — the server re-checks.
- Record scope: staff without `customer:read_all` see only customers assigned
  to them. Visibility of unassigned customers is TBD, so it is denied.
- Login is audited; suspended/disabled users cannot obtain a session.
- Login errors are generic — the response never reveals whether an account
  exists.
- Audit trail helper `logActivity()` writes actor, target, before/after.

### Doc 05 — Design System → `src/app/globals.css`, `src/components/ui.tsx`

- Every §2 semantic colour token, defined light and dark. No brand hex — final
  colours are a design approval, not a business rule.
- §3 type scale, §4 4px spacing base, §5 radius and minimal elevation.
- Components carry the §6 state set: default / hover / focus / disabled /
  loading / error / empty.
- Status is never colour-only — every badge carries text.
- Tables scroll horizontally inside their own container (§4).
- Focus rings are visible and never removed.

### Doc 04 — UI/UX → screens built so far

| Screen | Route | State |
| --- | --- | --- |
| UI-001 Login | `/login` | Done |
| UI-002 Dashboard | `/` | Done |
| UI-003 WhatsApp Inbox | `/inbox` | Done |
| UI-004 Customer List | `/customers` | Done |
| UI-005 Customer Profile | `/customers/[id]` | Done |
| UI-006 Customer 360 View | `/customers/[id]` | Done — merged into the profile |
| UI-007 Lead Pipeline | `/leads` | Done |
| UI-008 Follow-ups | `/follow-ups` | Done |
| UI-015 Templates | `/templates` | Done |
| UI-016 Template Editor | `/templates?edit=` | Done |
| UI-017 FAQ | `/faq` | Done |
| UI-012 Automations | `/automations` | Done |
| UI-013 Automation Builder | `/automations/[id]` | Done — read-only step map + validation report |
| UI-014 Automation Details | `/automations/[id]` | Done |
| UI-018 Staff | `/staff` | Done |
| UI-019 Staff Profile | `/staff/[id]` | Done |
| UI-025 Notifications | `/notifications` | Done |
| UI-009 Campaigns | `/campaigns` | Done |
| UI-010 Campaign Creation | `/campaigns/new`, `/campaigns/[id]/edit` | Done |
| UI-011 Campaign Details | `/campaigns/[id]` | Done |
| UI-020 Staff Scoring | `/staff-scoring` | Done - configuration editor + factor inputs |
| UI-021 Staff Comparison | `/staff-scoring` | Done - ranking, withheld unless comparable |
| UI-022 Analytics | `/analytics` | Done - filters, all KPI groups, source performance |
| UI-024 Activity Log | `/activity` | Done - append-only, security events highlighted |
| UI-026 Settings | `/settings` | Done - open decisions + emergency controls |
| UI-023, UI-027 | various | Placeholder naming its DEV phase |

The global shell (doc 04 §2) is built: persistent left sidebar with the
canonical 14 nav items in source order, top header with identity and sign-out,
page title/action area.

### Doc 10 — API Integration → `src/lib/whatsapp/`, `src/app/api/`

- **Provider adapter** (`adapter.ts`) — one interface, two implementations:
  `mock` (default, so the product runs before GAP-022 is decided) and `meta`
  (WhatsApp Cloud API v21.0). Normalizes inbound messages, structured
  button/list replies, provider message IDs, sent/delivered/read/failed status
  events, and classifies provider errors as retryable or not.
- **Inbound flow** (§7) — `inbound.ts`: verify → normalize → dedupe → persist →
  signal. Dedupe is the `provider_message_id` unique index, so a replayed
  webhook has one business effect. Status events are applied monotonically, so
  an out-of-order webhook never moves a message backwards.
- **Outbound flow** (§8) — `outbound.ts`: validate eligibility (opt-out,
  template active) → persist send intent → call provider → persist result. The
  intent row is written *before* the provider call, so an accepted message is
  never lost if the process dies mid-request.
- **Webhook** — `api/webhooks/whatsapp/route.ts`: GET handshake, POST with
  HMAC-SHA256 signature verification before any business processing. Unsigned
  traffic is rejected. 5xx on ingest failure so the provider retries; dedupe
  makes that replay safe.

### Doc 07 — Automation Specification → `src/lib/automation/`

- **Step model** (`types.ts`) — the action and condition vocabularies are
  exactly the §4 and §3 lists. Nothing extra invented, nothing dropped.
  Step types: `TRIGGER`, `CONDITION`, `ACTION`, `WAIT`, `BRANCH`.
- **Runtime** (`engine.ts`) — advances a run until it parks, completes or
  stops. A run parks either on a timer (`next_action_at`) or on a pending
  question. Nothing lives in worker memory, so a restart resumes exactly where
  it left off (§14).
- **Idempotency** (§13) — every executed step writes an `automation_events` row
  keyed `runId:stepKey:ask|do|answer`. A replayed tick or duplicate webhook
  cannot produce a second send or a second branch.
- **Worker** (`worker.ts`) — claims due runs with `FOR UPDATE SKIP LOCKED`, so
  two workers can never advance the same customer run twice (§13, explicit).
  A crash mid-advance returns the run to `WAITING` rather than stranding it.
- **Entry / re-entry** (`entry.ts`, §6) — one active run per customer per
  automation. Re-entry after a finished run is **off by default** and
  configurable per automation, because GAP-015 is undecided.
- **Validation** (`validate.ts`, §16) — missing branch targets, unreachable
  steps, unresolvable waits, zero-length waits, unsupported step types, and
  archived or missing templates. Activation is blocked until it passes.
- **Controls** (§11) — per-automation pause/resume/disable, per-customer run
  stop with actor and reason, and Admin-only pause-all. All audited.
- **Pause timer semantics** — GAP-016 is undecided, so the non-destructive
  reading is implemented: timers are preserved, not recalculated. A run due
  during a pause becomes due immediately on resume, never skipped or restarted.
- **Tick endpoint** — `POST /api/automation/tick`, bearer-authenticated with
  `AUTOMATION_TICK_SECRET`. Ticking more often than the shortest wait is
  harmless.

### DEV-009 — the 3% Club journey → `prisma/journeys.ts`

25 steps encoding BR-08/09/10/44/45 literally. The critical NO rule from
doc 17 §10 is **structurally enforced and tested**, not just documented:

| Requirement | How it is enforced | Test |
| --- | --- | --- |
| First NO recorded | `CustomerResponse` row + note step | ✓ |
| Information journey stops | NO path contains no `send_message` | ✓ |
| Marked for revision | status → `REVISIT_LATER`, tag `revision-pending` | ✓ |
| Wait exactly one day | `{ days: 1 }` — asserted not settings-driven | ✓ |
| Revision message sent when due | `revision_ask` branch after the wait | ✓ |
| Revision YES returns to the journey | rejoins at `yes_mark_interested`, never `intro` | ✓ |
| Second NO recorded, journey stops | status → `NOT_INTERESTED` then `stop_journey` | ✓ |
| Same message not repeated | whole second-NO tail asserted free of `send_message` | ✓ |
| Customer stays in CRM | run stops; the customer record is untouched | ✓ |

The no-response path (§8) reads its wait from
`automation.no_response_wait_hours`. That key is seeded `null` because GAP-002
is undecided, and a test asserts the journey does **not** hard-code a duration.
Unrecognised free text routes to `handoff_unclear` rather than being guessed
into a branch, because GAP-017 is undecided.

### DEV-011 Campaigns → `src/lib/campaigns/`, `src/app/(app)/campaigns/`

Implements FR-046 through FR-050.

- **Segment builder** (`segment.ts`) — a pure function: definition in, Prisma
  `where` out. The preview a manager approves and the audience frozen at launch
  call the *same* function, so they cannot disagree. Segmentable fields are the
  ones doc 17 §12 names: source, earlier campaign, tags (ANY/ALL), interest
  status, lead stage, customer status, customer type, owner, and entry date.
- **Opt-out is structural, not a filter.** The exclusion is added inside
  `segmentToWhere`, has no corresponding field in the definition schema, and a
  test asserts a crafted payload cannot remove it. Only the preview lifts it,
  and only to *count* how many it removed, which the UI then shows.
- **Audience snapshot** (doc 12 §11) — frozen into `campaign_audiences` when
  the campaign leaves Draft/Scheduled. Later customer edits cannot rewrite who
  a campaign was sent to. `snapshotAudience` is idempotent.
- **Dispatch** — a delivery row is claimed via the `(campaignId, customerId)`
  unique index *before* the provider call, so a replayed dispatch cannot
  message the same customer twice.
- **Stop is honoured mid-batch (TC-016)** — status is re-read before every
  individual send, not once per batch, so a stop lands immediately. Stop is
  terminal: `ALLOWED_TRANSITIONS` has no path out of `STOPPED` except archive,
  because resuming would message people a manager deliberately cut off. The
  detail page states how many were never reached.
- **Editing a started campaign is refused** in both the server action and the
  edit route, so what a campaign sent stays consistent with what it reports.
- **KPIs** (`campaignMetrics`, doc 12 §7) — audience, sent, delivered, read,
  replies, failed, leads, calls, meetings, conversions. Response rate states
  its denominator (replies ÷ sent). No attribution *window* is applied, because
  GAP-010 is undecided; campaign result taxonomy shows "Not defined".
- **Scheduling** — `dispatchDueCampaigns` runs on the same tick endpoint as the
  automation worker. Automations tick first, so a customer reply can stop a
  journey before the dispatcher would message them again.

### DEV-012 Staff scoring → `src/lib/scoring/`

The framework is complete. **No configuration is active, and the seed creates
none.** Doc 13 §4 is explicit: *Do not ship a production ranking formula until
management approves weights, normalization, caps and attribution.*

- **Factors** (`factors.ts`) — the twelve factors from doc 13 §2, each with a
  stated raw measure and direction. Two are negative (overdue follow-ups,
  assigned customers with no action), matching the source exactly. Five carry a
  `pendingDecision` note naming the open GAP their measure depends on; the UI
  prints that caveat beside the number rather than hiding it.
- **Configuration** (`config.ts`) — versioned, with an effective date. Per
  factor: enabled, weight, normalisation (raw / per-assigned / per-target /
  capped), cap, target. Per config: whether the total may go below zero,
  minimum sample size, score ceiling, approval note. **No factor has a default
  weight** — `null` means management has not decided, never zero.
- **The activation gate** (`readyForActivation`) is the mechanism that enforces
  §4. A configuration is refused activation if any enabled factor lacks a
  weight, a cap or target is missing its value, no approval note is recorded,
  or — notably — **every enabled factor is a raw count**, which doc 13 §4 warns
  favours larger workloads. Saving never activates; activation is a separate,
  explicit action, and editing an active config returns it to inactive.
- **Calculation** (`calculate.ts`) refuses outright when the configuration is
  not approvable, so an unweighted number cannot leak into a ranking. Every
  result carries its full derivation — raw, normalisation, normalised, weight,
  signed contribution — satisfying §10 explainability.
- **Ranking** (`rankable`, §8) is withheld, with a stated reason, if any staff
  member falls below the minimum sample size or has no calculable score.
- **Extraction** (`extract.ts`) reads the real facts from the database. These
  numbers are true regardless of weighting, so `/staff-scoring` and
  `/staff/[id]` show them whether or not a configuration exists.

Only one configuration can be live at a time (activating one deactivates the
rest and stamps its `effectiveTo`), so scores stay comparable under §6.

### DEV-013 Analytics → `src/lib/analytics/`

Doc 12 §1 states the requirement that shapes this phase: *dashboards and
reports must apply identical KPI definitions*. That is enforced structurally,
not by convention — the dashboard and the analytics page call the **same**
`computeMetrics` function, so a label cannot mean two different things in two
places.

- **Definitions** (`definitions.ts`) — 31 KPIs across the six groups doc 12
  names. Each states its population, numerator, denominator (where it is a
  rate) and time field, satisfying §1 literally. The analytics page can expand
  the definition table for any group, so a manager can check what a number
  means without reading the code.
- **Filters** (`filters.ts`) — the §2 dimensions: date range, source, campaign,
  staff, automation, lead stage, interest status. Pure, so period boundaries
  are tested rather than assumed. Last month cannot overlap this month; a
  reversed custom range is corrected rather than returned empty; `ALL` starts
  at the epoch rather than an invented lookback.
- **Computation** (`compute.ts`) — one function, filtered by record scope so a
  staff member's analytics only cover their own book. YES/NO counting reuses
  the automation engine's `normaliseAnswer`, so a button id, "Y" and "yes" are
  counted the same way in reports as in journeys — one definition, not two.
- **Source performance** (§9) — the required cohort, Customers → Interested →
  Calls → Meetings → Conversions by source, plus the source → responsible staff
  drill-through. Attribution uses the source recorded at customer entry;
  history is never rewritten.

**A KPI the source has not defined is not given a number.** Active Customers
(GAP-012) returns `null` and renders "Not defined" with its reason. A metric
whose *meaning* is a stand-in — Converted counts entry into the Converted stage
because GAP-009 leaves the criteria open — is computed but carries a printed
caveat rather than a silent assumption. Two tests hold that line: one asserts
Active Customers stays non-computable, the other that Converted stays computed
*and* flagged.

The page also states what it does not do: period boundaries use the server
timezone because GAP-020 is undecided, no campaign attribution window is
applied (GAP-010), and no test or internal records are excluded (GAP-035).

### Bug found and fixed during this phase

Building the no-response KPI exposed a defect in the automation engine. When a
branch question timed out, the worker woke the run, `advanceRun` reached the
same BRANCH step, found the "already asked" idempotency key, and re-parked with
a **fresh** timeout — re-arming the timer forever. The no-response branch would
never have run, and BR-14 / F-007 would have silently failed in production.

Fixed in `engine.ts`: arriving at a branch that was already asked now means the
timeout fired, so the run routes to `timeoutStepKey` and records a
`question.timeout` event (which is what the no-response KPI counts).

### DEV-014 + security hardening

See **`PRODUCTION.md`** for the full readiness assessment. Summary of what this
pass changed:

**Five defects found and fixed** — two S1, two S2, one S3 by doc 15 §6 severity:

1. **The webhook accepted unsigned POSTs.** `mock` is the default provider and
   its `verifyWebhook` returned `true` for any payload, so anyone knowing the
   URL could inject inbound messages and trigger real outbound sends. Now
   requires an HMAC signature even in development.
2. **A disabled account kept working.** JWT sessions were never re-checked, so
   suspending a user did nothing until the token expired. `currentUser()` now
   re-reads status *and* roles from the database every request.
3. **A branch timeout re-armed itself forever**, so no-response branches would
   never have fired (BR-14 / F-007 silently broken).
4. **Validation passed a journey that could never run** — branch timeouts were
   not checked for resolvable durations, so the 3% Club journey looked
   activatable while its no-response wait was unset.
5. **A database outage looked like a wrong password**, with nothing logged.

**Hardening added:** fail-fast configuration validation that refuses to boot a
misconfigured production (including refusing the `mock` provider and placeholder
secrets), auth rate limiting per client *and* per account, webhook rate limit
and body cap, CSP and the standard security headers, audited authorization
denials, and error boundaries carrying a support reference id.

**Screens:** `/activity` (append-only audit view, security events highlighted)
and `/settings` (the nine open business decisions with the consequence of each
spelled out, plus emergency pause-all).

### Doc 14 — Development Plan → completion criteria met so far

| Phase | Criterion | Status |
| --- | --- | --- |
| DEV-001 | Build/test pipeline passes; no secrets in repo | Met — `.env` gitignored, `.env.example` committed |
| DEV-002 | API-level RBAC for four source roles | Met — matrix + `assertPermission` on every action |
| DEV-003 | Customer source/history/ownership visible and audited | Met — source required on create, assignment history preserved, all changes logged |
| DEV-004 | Inbound/outbound and delivery/read/failure fixtures pass; duplicate webhook safe | Met — 6 tests green; dedupe via unique index |
| DEV-005 | Approved/available template validation blocks invalid sends | Partial — archived/inactive templates are blocked; full provider approval gating waits on GAP-027 |
| DEV-006 | Stage/history/follow-up tests pass; overdue queue correct | Met — every stage move writes history; overdue = pending and past due |
| DEV-007 | Customer request creates visible owned CRM action and history | Met — one creation service for both staff and automation; notification + audit on every request |
| DEV-008 | Durable timer/restart/idempotency and control tests pass | Met structurally — `FOR UPDATE SKIP LOCKED` claim, event idempotency keys, pause/resume/stop/pause-all. Runtime proof needs a database. |
| DEV-009 | TC-001..TC-005 pass including no repeated immediate messaging | Journey encoded and structurally tested (10 tests). TC-001..005 as *runtime* tests need a database. |
| DEV-011 | Audience preview, stop/pause and per-customer delivery reporting pass | Met — preview and launch share one resolver (11 tests); stop checked before every send; per-customer delivery table with a failures filter |
| DEV-012 | No production formula activated without approved configuration; score explainable | Met — the activation gate refuses incomplete configs, calculation refuses unapprovable ones, and every score prints its derivation (16 tests) |
| DEV-013 | KPI fixtures match source facts and filters | Partially met — definitions, filters and the shared computation are built and tested (15 tests). Matching against *fixtures* needs a database. |
| DEV-014 | Emergency controls auditable and protected | Met — pause-all is Admin-only, audited, and surfaced on both /automations and /settings; the activity log is append-only with no edit path |

---

## 4. File map

```text
prisma/
  schema.prisma            37 entities + system_settings
  seed.ts                  roles, permissions, 10 lead stages, 12 sources,
                           TBD settings placeholders, first admin
prisma.config.ts           Prisma 7 config (schema, migrations, seed, datasource)

src/
  auth.ts                  Auth.js v5 — credentials, JWT, audited login
  proxy.ts                 Next 16 proxy (was middleware) — cheap first gate

  lib/
    prisma.ts              PrismaClient + pg driver adapter
    rbac.ts                roles, permissions, doc 11 §4 matrix, record scope
    session.ts             currentUser / requireUser / requirePermission /
                           assertPermission
    activity.ts            audit trail writer (doc 11 §10)
    nav.ts                 the canonical 14 navigation items
    labels.ts              enum → business wording, lead stages, sources, tones
    settings.ts            business config for undecided values
    notifications.ts       in-app notifications + navigation targets
    requests.ts            single creation point for call/meeting requirements
    whatsapp/
      adapter.ts           provider interface + mock + Meta Cloud API
      adapter.test.ts      6 tests — parsing, dedupe shape, signature verify
      inbound.ts           doc 10 §7 ingest + opt-out + reply branching
      outbound.ts          doc 10 §8 send
    automation/
      types.ts             step configs — doc 07 §3/§4 vocabularies
      engine.ts            run advancement, branching, actions, idempotency
      entry.ts             enrolment and re-entry policy
      validate.ts          doc 07 §16 pre-activation validation
      worker.ts            durable timer claim (SKIP LOCKED) + tick

  components/
    ui.tsx                 doc 05 §6 primitives
    sidebar.tsx            nav with active state

  app/
    layout.tsx             root
    login/page.tsx         UI-001
    forbidden/page.tsx     denied-access page
    api/auth/[...nextauth]/route.ts
    api/webhooks/whatsapp/route.ts
    api/automation/tick/route.ts
    (app)/
      layout.tsx           authed shell — sidebar + header + sign-out
      page.tsx             UI-002 Dashboard
      customers/           UI-004, UI-005, UI-006 + actions
      inbox/               UI-003 three-pane + composer + actions
      leads/               UI-007 + actions
      follow-ups/          UI-008 + calls + meetings + actions
      templates/           UI-015, UI-016 + actions
      faq/                 UI-017 + actions
      automations/         UI-012, UI-013, UI-014 + controls + actions
      campaigns/           UI-009, UI-010, UI-011 + segment form + actions
      staff-scoring/       UI-020, UI-021 + config editor + actions
      staff/               UI-018, UI-019
      notifications/       UI-025 + actions
      env.ts                 fail-fast production config validation
    rate-limit.ts          in-process limiter for auth and webhooks
    setting-specs.ts       the open decisions, with consequences
    security.test.ts       13 tests - config guard, webhook, rate limiting
    analytics/           UI-022 + filters + definition tables
      activity|settings    placeholders naming their DEV phase
```

---

## 5. Deviations from the documentation

Doc 08 states technical content is *a recommendation, not a silent change to
the business requirements*. Two recommendations were not adopted. Both are
recorded here so the choice is visible, not buried.

### 5.1 NestJS → Next.js Server Actions

Doc 08 recommends NestJS for the API layer. Built instead as Server Actions and
Route Handlers inside the same Next.js app.

- Same modular boundaries: domain logic in `src/lib`, per-module `actions.ts`.
- Guards are `assertPermission()` rather than Nest guards — same enforcement
  point, server-side and authoritative.
- One process to deploy, monitor and secure instead of two.

**Reversible?** Yes. Domain logic is already isolated from components; moving it
behind HTTP later is mechanical.

### 5.2 Temporal → database-backed durable timers

Doc 08 recommends Temporal for long-running journeys. Built instead on
`automation_runs.next_action_at` with a worker claiming due rows through the
`(state, next_action_at)` index.

The source requirements this must satisfy (doc 07 §7, §8, §13):

| Requirement | How it is met |
| --- | --- |
| Wait exactly one day | `next_action_at = event + 24h`, claimed when due |
| Configured no-response wait | Same mechanism, duration from `system_settings` |
| Pause / resume | `paused_at` + `pause_remaining_ms` on the run row |
| Worker restart without losing state | State lives in Postgres, not worker memory |
| No duplicate advancement | Row claimed transactionally; `automation_events.idempotency_key` unique |
| Re-check before delayed send | Eligibility re-read at execution time |

**Reversible?** Yes. The run / step / event tables map onto Temporal workflows
without a schema change if measured load or journey complexity outgrows this.

---

## 6. How open business decisions are handled

The package lists **35 open decisions**. None have been silently invented.
Three techniques are used:

#### a) Undefined taxonomy → `String`, shown as "Not defined"

| Field | GAP | Why |
| --- | --- | --- |
| `customers.customer_status` | GAP-006 | No value list in source |
| `customers.customer_type` | GAP-032 | No value list in source |
| `customers.outcome`, `meetings.outcome` | GAP-008 | No canonical outcomes |
| `meetings.meeting_status` | GAP-007 | Not enumerated |
| `templates.approval_status` | GAP-027 | Provider lifecycle undecided |

The UI renders "Not defined" rather than a plausible-looking guess.

#### b) Undefined timing/policy → `system_settings` row seeded to `null`

`automation.no_response_wait_hours` (GAP-002) ·
`reporting.timezone` (GAP-020) · `messaging.send_window` (GAP-021) ·
`followup.sla_hours` (GAP-014) · `optout.keywords` (GAP-018) ·
`automation.pause_all` (BR-39, defaults `false`)

#### c) Undefined rule → record the fact, enforce nothing

- **GAP-003** stage transitions: any move is allowed, but *every* move writes
  `lead_stage_history`. When the transition rule is approved it can be enforced
  against a complete record.
- **GAP-009** conversion: reaching the Converted stage records the fact and
  sets interest status. No conversion *criteria* are asserted.
- **GAP-014** follow-up SLA: "overdue" means only "pending and past due". No
  escalation threshold invented.
- **GAP-004** duplicate customers: uniqueness is enforced on E.164 phone only.
  A create with an existing number is refused with a clear message rather than
  auto-merged.
- **GAP-001** staff scoring: no formula runs until a `staff_score_configs` row
  is approved and activated.
- **GAP-025** identity policy: Auth.js is deliberately swappable; no MFA or
  password policy asserted.

---

## 7. Verification

All green as of this update:

```bash
npm run typecheck        # next typegen && tsc --noEmit  → clean
npm run test             # node:test via tsx             → 71 pass, 0 fail
npm run build            # production build              → 28 routes compiled
npx eslint src prisma    # --max-warnings=0              → clean
```

Test breakdown:

| Suite | Covers | Count |
| --- | --- | --- |
| `src/lib/whatsapp/adapter.test.ts` | webhook parsing, structured replies, status events, subscription handshake, HMAC signature verification | 6 |
| `prisma/journeys.test.ts` | journey schema validity, no dangling targets, full reachability, and every clause of the critical NO rule | 10 |
| `src/lib/campaigns/segment.test.ts` | segment → filter mapping, tag ANY/ALL, unassigned override, malformed-definition fallback, and that the opt-out guard cannot be removed | 11 |
| `src/lib/scoring/calculate.test.ts` | the activation gate (including the all-raw-counts refusal), weighting arithmetic, per-assigned normalisation, zero-divide, capping, clamping, ranking withholding, and the twelve-factor set | 16 |
| `src/lib/analytics/analytics.test.ts` | period boundaries (including last-month non-overlap and reversed ranges), filter fallback, and the metric-definition contract | 15 |
| `src/lib/security.test.ts` | production config guard (mock provider, placeholder secrets, missing webhook secret), webhook signature verification, and rate limiting | 13 |

**Verified against a live database.** Supabase is connected, the migration and
seed have run (37 tables; roles resolve to ADMIN:44 / MANAGER:37 / STAFF:19 /
VIEWER:14 permissions; 0 scoring configs, as intended). Every route renders 200
with a real session, and the security fixes were each confirmed at runtime:
unsigned webhook rejected, signed accepted, rate limit triggering after the
configured attempts, and a suspended account losing access mid-session.

Test coverage today is the highest-risk *pure* logic: the WhatsApp webhook
parser, signature verification, and the structure of the 3% Club journey
including every clause of the critical NO rule. Database-touching paths
(dedupe, status monotonicity, follow-up rescheduling, stage history, timer
claiming, run advancement) are written but unproven until a database exists.

QA test cases TC-001 through TC-007 are *structurally* satisfied by
`prisma/journeys.test.ts`, but they are runtime scenarios — advance a clock,
ingest a reply, assert no early send — and become real tests only against a
database.

---

## 8. Blocked on

| Item | Needed from | Impact |
| --- | --- | --- |
| Postgres connection string | Supabase project | Blocks migrate, seed, and any runtime verification |
| GAP-022 provider selection | Technical/commercial decision | `mock` adapter runs meanwhile; `meta` implementation is ready |
| GAP-002 no-response wait | Business | DEV-010 cannot ship a real wait value |
| GAP-001 scoring weights | Management | Framework built; no configuration is active. See §10 for the nine decisions needed. |
| GAP-015 / GAP-016 re-entry and pause semantics | Business | Built configurable with a restrictive default rather than assumed |
| GAP-017 free-text interpretation | Business | Unrecognised replies stop the run and hand to staff |
| GAP-018 opt-out keywords | Business | `optout.keywords` is seeded empty, so no keyword suppresses anyone yet |
| GAP-010 campaign attribution window | Business | Campaign KPIs count facts with no attribution window applied |
| GAP-033 project/plot interest | Business | Not offered as a campaign segment field; a test guards against adding it silently |

### Supabase setup, when ready

```bash
# .env
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:5432/postgres"

npm run db:migrate && npm run db:seed && npm run dev
```

Migrations need the direct (5432) URL; the pooled (6543) URL is for runtime.

---

## 9. Next up

**DEV-014 Admin, settings and activity** — the activity log view (UI-024),
the settings screen where the resolved GAP decisions are entered, and the
emergency controls surfaced together. Most of the underlying pieces already
exist: `logActivity` writes on every mutation, `system_settings` holds the
pending decisions, and pause-all is already wired.

Then DEV-015 (hardening, QA, accessibility, performance) and DEV-016
(deployment).

---

## 10. Decisions needed to activate staff scoring

The framework is built and tested, but it will refuse to produce a score until
management answers these. Doc 13 §5 lists them; the activation gate enforces
the ones that are structural.

| # | Decision | Enforced by the gate? |
| --- | --- | --- |
| 1 | Weight per factor | Yes — an enabled factor with no weight blocks activation |
| 2 | Normalisation basis (per assigned lead, target, percentile, capped points) | Yes — an all-raw-count config is refused |
| 3 | Whether workload/opportunity differences are normalised | Yes, via #2 |
| 4 | Definition of qualifying customer contact and response activity | No — a stand-in measure is used and labelled |
| 5 | Attribution for calls/meetings/conversions after reassignment (GAP-011) | No — credit currently follows the owner at completion |
| 6 | Outcome taxonomy and points (GAP-008) | No — only presence of an outcome is counted |
| 7 | Treatment of leave/inactive periods | No |
| 8 | Minimum sample size before ranking | Configurable; ranking is withheld below it |
| 9 | Whether the score may fall below zero, and the final range | Configurable |

Items 4 through 7 are not gate-enforceable — no code can tell that a stand-in
measure is the wrong one. They are surfaced instead: the factor carries a
`pendingDecision` note that prints beside every number it produces, in the
configuration editor and in each score breakdown.
