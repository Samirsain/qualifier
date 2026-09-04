# WhatsApp Qualification Filter — Design

**Date:** 2026-09-04
**Status:** Approved for implementation planning
**Supersedes:** the CRM scope described in `PROGRESS.md` (DEV-006, DEV-007,
DEV-011, DEV-012 and parts of DEV-013)

---

## 1. What this is

A WhatsApp qualification filter. It takes a list of phone numbers, runs them
through a funnel the business builds itself, and produces a filtered list of the
people who asked to be contacted.

```
List of numbers  →  funnel runs  →  qualified numbers  →  external CRM team calls them
```

The system's entire job is **narrowing**: turning a thousand cold numbers into
sixty warm ones. Everything that happens after the call — pipeline, negotiation,
closing — belongs to a CRM team outside this system.

**This is not a CRM.** The previous build assumed it was, and that assumption
produced roughly half the code now being removed.

---

## 2. Why this changed

The original documentation package described a full customer-management
platform: staff assignment, follow-up queues, call and meeting records, a
ten-stage pipeline, staff scoring, campaign analytics.

The business has since clarified that a CRM team already exists and works
outside this system. Their people do not operate a dashboard. What they need is
the step *before* their CRM: an automated first conversation that separates
interested people from uninterested ones, so their team only dials numbers worth
dialling.

Keeping the CRM features would mean maintaining a second, unused CRM alongside
the real one.

---

## 3. Scope

### In scope

| Capability | Notes |
|---|---|
| Upload a list of numbers and start a funnel | Paste or CSV |
| Edit message templates | Free text with `{{name}}` personalisation |
| Build funnels from steps | Four step types, see §6 |
| Run funnels with durable timers | Existing engine, unchanged |
| Handle YES / NO / no-response branches | Existing engine, unchanged |
| Produce a qualified list | The system's output, see §7 |
| Export qualified numbers as CSV | The handover to the CRM team |
| Notify the owner when someone qualifies | In-app; no assignment |
| A light inbox for off-funnel replies | Read and reply only |

### Out of scope — removed from the existing build

Staff profiles and staff roles beyond login · customer assignment · staff
scoring · follow-up queues · call and meeting records · the ten-stage lead
pipeline · lead stage history · the Customer 360 timeline · campaign analytics ·
FAQ module · tags · sources · report definitions.

### Explicit non-goals

- This system does not track what happens after a number is handed over.
- It does not measure staff performance. There is no staff to measure.
- It does not replace the CRM team's tooling.

---

## 4. What is reused unchanged

These are already built, tested and stay exactly as they are:

- **WhatsApp provider adapter** (`src/lib/whatsapp/`) — mock and Meta Cloud API,
  signed webhooks, idempotent ingest, monotonic status handling
- **Automation engine** (`src/lib/automation/`) — step execution, branch
  handling, durable timers via `next_action_at`, `FOR UPDATE SKIP LOCKED`
  claiming, event idempotency keys, validation, pause/resume/stop
- **Security** — config validation, rate limiting, security headers, session
  revocation, audit logging
- **Database layer** — Prisma with the pg driver adapter, migrations

**The engine's structure is not modified.** Step execution, branching, timers,
claiming and idempotency stay exactly as they are, and the funnel builder writes
the same `automation_steps` rows the engine already reads. This is the central
reason the rescope is cheap.

Two narrow changes are unavoidable, because they reference tables being dropped:

- `executeAction` loses the `create_follow_up`, `create_call_request` and
  `create_meeting_request` branches, and the `assign_staff` branch.
- `change_customer_status` wrote both `customers.interestStatus` and
  `leads.interestStatus`. With `leads` gone and the field renamed, it is
  replaced by a dedicated `mark_qualified` action (see §6).

Everything else in `engine.ts`, `entry.ts`, `worker.ts` and `validate.ts` is
untouched.

---

## 5. Data model

### Tables kept

`users` · `customers` · `templates` · `automations` · `automation_steps` ·
`automation_runs` · `automation_events` · `customer_responses` ·
`conversations` · `messages` · `notifications` · `system_settings` ·
`activity_logs`

### Tables added

**`batches`** — one upload of numbers against one funnel.

| Field | Notes |
|---|---|
| `id` | uuid |
| `name` | e.g. "Facebook leads, September" |
| `automationId` | which funnel to run |
| `automationVersion` | frozen at start, so an edited funnel does not change a running batch |
| `status` | `DRAFT` / `RUNNING` / `PAUSED` / `STOPPED` / `COMPLETED` |
| `createdById`, `createdAt`, `startedAt`, `completedAt` | |

**`batch_members`** — the frozen audience.

| Field | Notes |
|---|---|
| `batchId`, `customerId` | composite primary key |
| `enrolledAt` | null until the funnel actually started for them |
| `skippedReason` | e.g. "opted out", "already in this funnel" |

Reuses the audience-snapshot and per-member idempotent dispatch behaviour proven
in the campaign runner, with one substitution: dispatch calls `enrolCustomer()`
instead of `sendToCustomer()`.

### Tables dropped

`staff_profiles` · `leads` · `lead_stages` · `lead_stage_history` ·
`follow_ups` · `calls` · `meetings` · `staff_assignments` ·
`staff_score_configs` · `staff_scores` · `report_definitions` · `faqs` ·
`tags` · `customer_tags` · `sources` · `campaigns` · `campaign_audiences` ·
`campaign_deliveries` · `template_usages` · `roles` · `permissions` ·
`user_roles` · `role_permissions`

### `customers` — trimmed

Kept: `id`, `name`, `phoneE164` (unique), `email`, `location`, `status`,
`batchId`, `optedOutAt`, `lastInteractionAt`, `qualifiedAt`, `exportedAt`,
`createdAt`, `updatedAt`.

Dropped: `sourceId`, `sourceDetail`, `campaignId`, `customerType`,
`interestStatus`, `customerStatus`, `assignedStaffId`, `nextFollowUpAt`,
`requirements`, `outcome`, `conversionStatus`.

### Status — ten stages become five

```
NOT_STARTED    uploaded, funnel has not reached them yet
IN_FUNNEL      currently in a journey
QUALIFIED      asked to be contacted — this is the output
NOT_INTERESTED said no, or said no twice at the revision
NO_RESPONSE    never replied within the configured window
```

`qualifiedAt` is a separate timestamp so the export can be ordered and filtered
by when someone qualified, independent of the status field.

### Roles

The four-role RBAC matrix collapses to two, stored as a `role` column on
`users` rather than join tables:

- **ADMIN** — everything
- **VIEWER** — read and export only

`src/lib/rbac.ts` keeps its `can()` shape so call sites are unchanged; only the
permission list and matrix shrink.

---

## 6. The funnel builder

The engine supports seven step types. The builder exposes four:

| Builder step | Engine equivalent | Configuration |
|---|---|---|
| **Send message** | `ACTION` / `send_message` | pick a template |
| **Ask question** | `BRANCH` | template + YES target + NO target + unrecognised-reply target |
| **Wait** | `WAIT` | days and/or hours |
| **Mark qualified** | `ACTION` / `mark_qualified` | sets `status` to `QUALIFIED` and stamps `qualifiedAt` |

`mark_qualified` is a new, dedicated action rather than a reuse of
`change_customer_status`. Overloading a general status-setter would make the
system's single most important event indistinguishable from any other status
change in the audit log.

The remaining engine capabilities (tags and conditions) stay in the engine but
are not surfaced in the builder. Exposing one later is a UI change, not an
engine change.

### Editing and versions

A funnel is a list of steps, reordered by drag or up/down controls. Each step
has a stable `stepKey`; branch targets reference those keys.

- Editing a `DRAFT` funnel edits it in place.
- Editing an `ACTIVE` funnel **creates a new version**. Runs already in flight
  keep executing their own version, because `automation_runs.automationVersion`
  already pins it. A customer part-way through a journey never has the ground
  shift under them.

### Validation before activation

The existing `validateAutomation()` already covers what is needed: missing
branch targets, unreachable steps, unresolvable or zero-length waits, archived
templates. One rule is added:

- **A funnel must contain at least one "Mark qualified" step.** A funnel that
  cannot qualify anyone has no output, and is almost certainly a mistake.

---

## 7. The qualified list — the system's output

A single screen, and the reason the system exists.

**Columns:** name · phone · qualified at · batch · which funnel · the answer
they gave.

**Filters:** batch, date range, and "not yet exported".

**Export:** CSV download with columns `name, phone, qualified_at, batch, funnel`.
Exporting stamps `exportedAt` on those rows so the next export can exclude them
— the CRM team should not receive the same number twice.

`exportedAt` is a nullable timestamp on `customers`. Re-exporting an already
exported row stays possible, but requires clearing the filter deliberately.

---

## 8. Screens

| Screen | Purpose |
|---|---|
| **Batches** | List of uploads with progress. Create: name it, pick a funnel, paste or upload numbers, review the parsed list, start. |
| **Batch detail** | Live view — how many not started, in funnel, qualified, not interested, no response. Pause and stop controls. |
| **Templates** | Create and edit messages, with preview. |
| **Funnels** | List, plus the step builder and validation report. |
| **Qualified** | The output list, filters and CSV export. |
| **Inbox** | Off-funnel replies. Read and reply, nothing else. |
| **Settings** | Wait durations, WhatsApp connection, opt-out keywords, emergency pause-all. |

Plus login. Seven routes plus login, down from twenty-eight.

---

## 9. Number upload

**Formats:** paste (one per line, `name,phone` or just `phone`), or CSV upload
with a `phone` column and optional `name`.

**Parsing rules:**

The default country is **India (+91)**, because in practice almost every number
loaded will be Indian. It is a setting (`numbers.default_country`), not a
constant, so a non-Indian list is a configuration change rather than a code
change.

A bare number is completed to E.164 only when it matches a real Indian mobile
shape. Indian mobile numbers are exactly ten digits and begin with 6, 7, 8 or 9,
so that rule does the validating — a ten-digit number that is not a plausible
mobile is still rejected rather than silently given a +91.

| Input | Result |
|---|---|
| `+919876543210` | accepted as-is |
| `919876543210` | `+919876543210` |
| `09876543210` | leading zero dropped → `+919876543210` |
| `9876543210` | `+919876543210` — assumed Indian |
| `98765 43210`, `98765-43210` | spaces and dashes stripped, then as above |
| `1234567890` | **rejected** — ten digits but not a valid mobile prefix |
| `987654321` / `98765432101` | **rejected** — wrong length |
| `+14155552671` | accepted as-is — an explicit country code is always honoured |

Other rules:

- Duplicates within the file are collapsed, and the count is reported.
- A number already in the database is reused, not duplicated (`phoneE164` stays
  unique).
- A number with `optedOutAt` set is added to the batch as skipped, with the
  reason shown — visible, not silently dropped.
- Every rejected row is reported with its **row number and the reason**, so the
  file can be corrected rather than re-guessed.

**Review before start:** the parsed result is shown before anything is sent —
how many valid, how many rejected and why, how many already opted out, and
**how many had +91 assumed**. That last count is shown deliberately: assuming a
country code is the one step that can send a message to the wrong person, so it
is stated rather than buried. The batch starts only on an explicit action.

---

## 10. Migration plan

The database currently holds only reference data and one admin user, so no
customer data is at risk.

1. Write the trimmed Prisma schema.
2. Generate one migration that drops the removed tables and alters `customers`
   and `users`. Destructive, and safe here precisely because there is nothing to
   lose — this must happen **before** any real numbers are loaded.
3. Delete the code for removed modules.
4. Update the seed: no lead stages, no sources, no permission matrix. Seed
   admin, settings and one starter funnel.
5. Rewrite `prisma/journeys.ts` as a starter funnel using only the four exposed
   step types, ending in "Mark qualified".

---

## 11. Decisions still open

| # | Decision | Effect while open |
|---|---|---|
| 1 | WhatsApp provider (GAP-022) | Nothing can be sent. Production refuses to start on `mock`. |
| 2 | No-response wait duration (GAP-002) | Funnels with a no-response branch cannot be activated. |
| 3 | Opt-out keywords (GAP-018) | Replying STOP is treated as an unrecognised reply. |
| 4 | Business timezone (GAP-020) | Date filters on the export use the server day. |
| 5 | Default country for bare numbers | Decided: **India (+91)**. Stored as a setting, changeable without code. |

Decisions 2 through 4 are entered in Settings. Decision 1 is commercial.

---

## 12. Risks

**The funnel builder is the only substantially new code.** Everything else is
deletion or reuse. If it is wrong, it is wrong in the UI layer, where the blast
radius is small — the engine underneath is already tested.

**Deleting is irreversible in this repo.** The project is not currently under
version control (see §13), so the removed modules have no history to recover
from. Version control must exist before step 3 of the migration plan.

**The starter funnel is a worked example, not an approved script.** Its message
copy is placeholder text. Real business-initiated WhatsApp messages must use
provider-approved templates.

---

## 13. Prerequisite: version control

`C:\Users\Sai\Desktop\auto\3percent-club` is not a git repository. This spec
cannot be committed, and more importantly the deletion in §10 would be
unrecoverable.

**`git init` and an initial commit must happen before implementation begins.**
This is the first task in the implementation plan.
