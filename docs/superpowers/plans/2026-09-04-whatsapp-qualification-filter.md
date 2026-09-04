# WhatsApp Qualification Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing CRM-scoped build into a WhatsApp qualification filter — upload numbers, run a self-built funnel, export the numbers that asked to be contacted.

**Architecture:** Strip roughly half the existing app, keep the automation engine untouched, and add three new pieces on top of it: a funnel builder that writes `automation_steps` rows, a batch uploader that enrols numbers into a funnel, and a qualified list that exports to CSV. The engine's durable timers, idempotency and branch handling already work and are not being rewritten.

**Tech Stack:** Next.js 16.3.4 (App Router, Turbopack), React 19.2, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 18 (Supabase), Auth.js v5, Tailwind CSS 4, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-04-whatsapp-qualification-filter-design.md`

## Global Constraints

- **The automation engine's structure is not modified.** `engine.ts`, `entry.ts`, `worker.ts` keep their current logic. Only `executeAction`'s action list changes (Task 3).
- **Default country is India (`+91`)**, stored as setting `numbers.default_country`, never hardcoded as a constant.
- **Indian mobile validation:** exactly 10 digits, first digit `6`, `7`, `8` or `9`. A 10-digit number failing this is rejected, not prefixed.
- **An explicit country code is always honoured** — `+1...` stays `+1...`.
- **Statuses are exactly five:** `NOT_STARTED`, `IN_FUNNEL`, `QUALIFIED`, `NOT_INTERESTED`, `NO_RESPONSE`.
- **Roles are exactly two:** `ADMIN`, `VIEWER`, as a column on `users`.
- Every task ends with `npm run typecheck && npm test` passing.
- Commit after every task. Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Do not commit `.env`. It is gitignored; keep it that way.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/phone.ts` | Parse one raw number to E.164. Pure. |
| `src/lib/phone.test.ts` | Tests for the above. |
| `src/lib/numbers/parse-list.ts` | Parse a pasted/uploaded list into rows. Pure. |
| `src/lib/numbers/parse-list.test.ts` | Tests for the above. |
| `src/lib/funnels/steps.ts` | Convert builder steps ↔ `automation_steps` rows. Pure. |
| `src/lib/funnels/steps.test.ts` | Tests for the above. |
| `src/lib/batches/runner.ts` | Freeze a batch audience, enrol members, report progress. |
| `src/app/(app)/funnels/page.tsx` | Funnel list. |
| `src/app/(app)/funnels/[id]/page.tsx` | Funnel builder. |
| `src/app/(app)/funnels/[id]/builder.tsx` | Builder client component. |
| `src/app/(app)/funnels/actions.ts` | Save, activate, duplicate a funnel. |
| `src/app/(app)/batches/page.tsx` | Batch list. |
| `src/app/(app)/batches/new/page.tsx` | Upload numbers. |
| `src/app/(app)/batches/new/upload-form.tsx` | Paste/upload + review client component. |
| `src/app/(app)/batches/[id]/page.tsx` | Batch progress. |
| `src/app/(app)/batches/actions.ts` | Create, start, pause, stop a batch. |
| `src/app/(app)/qualified/page.tsx` | The output list. |
| `src/app/(app)/qualified/actions.ts` | Mark rows exported. |
| `src/app/api/qualified/export/route.ts` | CSV download. |

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | Trim to 15 models. |
| `prisma/seed.ts` | Drop reference data that no longer exists. |
| `prisma/journeys.ts` | Rewrite as a starter funnel using four step types. |
| `src/lib/rbac.ts` | Two roles, ~12 permissions. |
| `src/lib/nav.ts` | Six items. |
| `src/lib/labels.ts` | Five statuses; drop stages/sources. |
| `src/lib/automation/types.ts` | Trim action union; add `mark_qualified`. |
| `src/lib/automation/engine.ts` | Trim `executeAction`. |
| `src/lib/automation/validate.ts` | Require one `mark_qualified` step. |
| `src/lib/setting-specs.ts` | Drop dead settings; add `numbers.default_country`. |
| `src/app/(app)/layout.tsx` | Role display. |
| `src/app/api/automation/tick/route.ts` | Dispatch batches, not campaigns. |

**Deleted** — listed in Task 2.

---

## Task 1: Phone parsing

Pure logic with no dependencies, so it can be built and proven before anything is torn down.

**Files:**
- Create: `src/lib/phone.ts`
- Test: `src/lib/phone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parsePhone(raw: string, defaultCountry?: "IN"): ParsedPhone` where
  `ParsedPhone = { ok: true; e164: string; assumedCountry: boolean } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/phone.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parsePhone } from "./phone";

test("an explicit country code is honoured unchanged", () => {
  const r = parsePhone("+919876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, false);
});

test("a foreign number keeps its own country code", () => {
  const r = parsePhone("+14155552671");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+14155552671");
  assert.equal(r.assumedCountry, false);
});

test("a bare ten-digit Indian mobile gets +91 and is flagged as assumed", () => {
  for (const n of ["9876543210", "6123456789", "7000000000", "8999999999"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, true, `${n} should parse`);
    if (!r.ok) continue;
    assert.equal(r.e164, `+91${n}`);
    assert.equal(r.assumedCountry, true);
  }
});

test("a leading zero is dropped", () => {
  const r = parsePhone("09876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, true);
});

test("a bare 91-prefixed number is treated as explicit, not assumed", () => {
  const r = parsePhone("919876543210");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.e164, "+919876543210");
  assert.equal(r.assumedCountry, false);
});

test("spaces, dashes, dots and brackets are ignored", () => {
  for (const n of ["98765 43210", "98765-43210", "(98765) 43210", "98765.43210"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, true, `${n} should parse`);
    if (r.ok) assert.equal(r.e164, "+919876543210");
  }
});

test("a ten-digit number that is not a mobile prefix is rejected, never prefixed", () => {
  for (const n of ["1234567890", "5555555555", "0123456789"]) {
    const r = parsePhone(n);
    assert.equal(r.ok, false, `${n} must be rejected`);
  }
});

test("wrong lengths are rejected with a stated reason", () => {
  assert.equal(parsePhone("987654321").ok, false);
  assert.equal(parsePhone("98765432101").ok, false);
  const r = parsePhone("987654321");
  if (!r.ok) assert.match(r.reason, /10 digits/);
});

test("letters and empty input are rejected", () => {
  assert.equal(parsePhone("98765abcde").ok, false);
  assert.equal(parsePhone("").ok, false);
  assert.equal(parsePhone("   ").ok, false);
});

test("an explicit + number that is malformed is rejected", () => {
  assert.equal(parsePhone("+9").ok, false);
  assert.equal(parsePhone("+0123456789").ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/phone.test.ts`
Expected: FAIL — `Cannot find module './phone'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/phone.ts`:

```ts
/**
 * Phone parsing for number upload.
 *
 * The default country is India, because in practice almost every number loaded
 * will be Indian. A bare number is only completed to +91 when it matches a real
 * Indian mobile shape — exactly ten digits beginning 6, 7, 8 or 9 — so a
 * ten-digit number that is not a plausible mobile is rejected rather than
 * silently given a country code and messaged.
 *
 * An explicit country code is always honoured.
 */

export type ParsedPhone =
  | { ok: true; e164: string; assumedCountry: boolean }
  | { ok: false; reason: string };

export type SupportedCountry = "IN";

/** Indian mobile: 10 digits, first digit 6-9. */
const IN_MOBILE = /^[6-9]\d{9}$/;

/** E.164: + then 8 to 15 digits, first digit not zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function parsePhone(
  raw: string,
  defaultCountry: SupportedCountry = "IN",
): ParsedPhone {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  // Strip the separators people actually paste.
  const cleaned = trimmed.replace(/[\s()\-.]/g, "");

  if (/[^\d+]/.test(cleaned)) {
    return { ok: false, reason: "contains characters that are not digits" };
  }

  if (cleaned.startsWith("+")) {
    if (!E164.test(cleaned)) {
      return { ok: false, reason: "not a valid international number" };
    }
    return { ok: true, e164: cleaned, assumedCountry: false };
  }

  if (/\+/.test(cleaned)) {
    return { ok: false, reason: "misplaced +" };
  }

  const digits = cleaned;

  if (defaultCountry === "IN") {
    // 91XXXXXXXXXX — the country code is present, just without the plus.
    if (digits.length === 12 && digits.startsWith("91")) {
      const national = digits.slice(2);
      if (!IN_MOBILE.test(national)) {
        return { ok: false, reason: "not a valid Indian mobile number" };
      }
      return { ok: true, e164: `+91${national}`, assumedCountry: false };
    }

    // 0XXXXXXXXXX — national dialling prefix.
    if (digits.length === 11 && digits.startsWith("0")) {
      const national = digits.slice(1);
      if (!IN_MOBILE.test(national)) {
        return { ok: false, reason: "not a valid Indian mobile number" };
      }
      return { ok: true, e164: `+91${national}`, assumedCountry: true };
    }

    if (digits.length === 10) {
      if (!IN_MOBILE.test(digits)) {
        return {
          ok: false,
          reason: "not a valid Indian mobile number (must start 6, 7, 8 or 9)",
        };
      }
      return { ok: true, e164: `+91${digits}`, assumedCountry: true };
    }

    return {
      ok: false,
      reason: `expected 10 digits for an Indian mobile, got ${digits.length}`,
    };
  }

  return { ok: false, reason: "unsupported default country" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/phone.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Verify the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, 81 tests pass (71 existing + 10 new)

- [ ] **Step 6: Commit**

```bash
git add src/lib/phone.ts src/lib/phone.test.ts
git commit -m "feat: phone parsing with India default and mobile validation

A bare 10-digit number is completed to +91 only when it matches a real
Indian mobile shape (10 digits starting 6-9), so 1234567890 is rejected
rather than prefixed. Explicit country codes are always honoured, and the
result flags whether a country code was assumed so the upload review can
report that count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Delete the CRM modules

The schema is untouched here, so the app still compiles at the end of this task. Schema work is Task 3.

**Files:**
- Delete: the directories and files listed below
- Modify: `src/lib/nav.ts`, `src/lib/rbac.ts`, `src/lib/labels.ts`, `src/app/(app)/layout.tsx`

- [ ] **Step 1: Delete the UI modules**

```bash
git rm -r "src/app/(app)/staff" "src/app/(app)/staff-scoring" \
          "src/app/(app)/follow-ups" "src/app/(app)/leads" \
          "src/app/(app)/campaigns" "src/app/(app)/analytics" \
          "src/app/(app)/faq" "src/app/(app)/customers/[id]"
```

- [ ] **Step 2: Delete the library modules**

```bash
git rm -r src/lib/scoring src/lib/analytics src/lib/campaigns
git rm src/lib/requests.ts
```

- [ ] **Step 3: Rewrite the navigation**

Replace `src/lib/nav.ts` entirely:

```ts
import type { Permission } from "@/lib/rbac";

/** Six screens. The system narrows a list; it does not manage customers. */
export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
};

export const NAV: NavItem[] = [
  { href: "/batches", label: "Batches", permission: "batch:read" },
  { href: "/qualified", label: "Qualified", permission: "qualified:read" },
  { href: "/funnels", label: "Funnels", permission: "funnel:read" },
  { href: "/templates", label: "Templates", permission: "template:read" },
  { href: "/inbox", label: "Inbox", permission: "conversation:read" },
  { href: "/settings", label: "Settings", permission: "settings:read" },
];
```

- [ ] **Step 4: Rewrite RBAC to two roles**

Replace `src/lib/rbac.ts` entirely:

```ts
/**
 * Two roles. There is no staff structure — the CRM team works outside this
 * system, so there is nobody to assign customers to and nothing to score.
 */

export const ROLES = ["ADMIN", "VIEWER"] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

export const PERMISSIONS = [
  "batch:read",
  "batch:manage",
  "qualified:read",
  "qualified:export",
  "funnel:read",
  "funnel:manage",
  "template:read",
  "template:manage",
  "conversation:read",
  "conversation:reply",
  "settings:read",
  "settings:manage",
  "automation:pause_all",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "batch:read",
  "qualified:read",
  "qualified:export",
  "funnel:read",
  "template:read",
  "conversation:read",
  "settings:read",
];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  VIEWER: VIEWER,
};

export function can(roles: readonly RoleCode[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}
```

Note: `customerScope()` is deleted. Nothing scopes by staff any more.

- [ ] **Step 5: Rewrite labels**

Replace `src/lib/labels.ts` entirely:

```ts
/** The five statuses a number can be in. */
export const CUSTOMER_STATUS_LABELS = {
  NOT_STARTED: "Not started",
  IN_FUNNEL: "In funnel",
  QUALIFIED: "Qualified",
  NOT_INTERESTED: "Not interested",
  NO_RESPONSE: "No response",
} as const;

export type CustomerStatusKey = keyof typeof CUSTOMER_STATUS_LABELS;

export const BATCH_STATUS_LABELS = {
  DRAFT: "Draft",
  RUNNING: "Running",
  PAUSED: "Paused",
  STOPPED: "Stopped",
  COMPLETED: "Completed",
} as const;

export const AUTOMATION_STATUS_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DISABLED: "Disabled",
} as const;

type Tone = "neutral" | "success" | "warning" | "error" | "info";

export function statusTone(status: string): Tone {
  switch (status) {
    case "QUALIFIED":
    case "ACTIVE":
    case "RUNNING":
    case "COMPLETED":
    case "DELIVERED":
    case "READ":
      return "success";
    case "IN_FUNNEL":
    case "SENT":
    case "QUEUED":
      return "info";
    case "PAUSED":
    case "NO_RESPONSE":
      return "warning";
    case "NOT_INTERESTED":
    case "STOPPED":
    case "DISABLED":
    case "FAILED":
      return "error";
    default:
      return "neutral";
  }
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
```

- [ ] **Step 6: Fix the remaining compile errors**

Run: `npm run typecheck`

Fix each error by removing the reference. Expected sites:
- `src/app/(app)/page.tsx` — the dashboard imports analytics. Replace its whole body with a redirect, since Batches is now the home screen:

```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/batches");
}
```

- `src/app/(app)/customers/page.tsx` and `src/app/(app)/customers/new/*` — delete these too; numbers arrive by batch upload now:

```bash
git rm -r "src/app/(app)/customers"
```

- `src/app/(app)/inbox/*`, `src/app/(app)/templates/*`, `src/app/(app)/notifications/*`, `src/app/(app)/activity/*`, `src/app/(app)/settings/*`, `src/app/(app)/automations/*` — remove imports of `customerScope`, and replace `customerScope(user.roles, user.id)` with `{}`.
- `src/app/(app)/layout.tsx` — `ROLE_LABELS` still exists, so only the import list may need trimming.

Repeat until typecheck is clean.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test && npx eslint src prisma --max-warnings=0`
Expected: typecheck clean, tests pass (the scoring/analytics/campaign test files are gone — expect 34 tests: 10 phone + 6 adapter + 13 security + 5 remaining journey), lint clean

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove CRM modules

The CRM team works outside this system, so staff assignment, scoring,
follow-up queues, the lead pipeline, campaigns and their analytics have no
operator and no purpose here. Roles collapse to Admin and Viewer.

Schema untouched in this commit; that is the next one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Trim the schema and the engine's action list

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/automation/types.ts`, `src/lib/automation/engine.ts`, `prisma/seed.ts`
- Create: `prisma/migrations/<timestamp>_qualification_filter/migration.sql` (generated)

**Interfaces:**
- Produces: `mark_qualified` action; `CustomerStatus` enum; `Batch` and `BatchMember` models.

- [ ] **Step 1: Trim `prisma/schema.prisma`**

Delete these models entirely: `StaffProfile`, `Lead`, `LeadStage`, `LeadStageHistory`, `FollowUp`, `Call`, `Meeting`, `StaffAssignment`, `StaffScoreConfig`, `StaffScore`, `ReportDefinition`, `Faq`, `Tag`, `CustomerTag`, `Source`, `Campaign`, `CampaignAudience`, `CampaignDelivery`, `TemplateUsage`, `Role`, `Permission`, `UserRole`, `RolePermission`.

Delete these enums: `InterestStatus`, `CampaignStatus`, `CallStatus`, `ScorePeriod`, `FollowUpStatus`.

Add:

```prisma
enum CustomerStatus {
  NOT_STARTED
  IN_FUNNEL
  QUALIFIED
  NOT_INTERESTED
  NO_RESPONSE
}

enum BatchStatus {
  DRAFT
  RUNNING
  PAUSED
  STOPPED
  COMPLETED
}

model Batch {
  id                String      @id @default(uuid()) @db.Uuid
  name              String
  automationId      String      @db.Uuid
  automationVersion Int
  status            BatchStatus @default(DRAFT)
  createdById       String      @db.Uuid
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  automation Automation    @relation(fields: [automationId], references: [id])
  createdBy  User          @relation(fields: [createdById], references: [id])
  members    BatchMember[]
  customers  Customer[]

  @@index([status, createdAt])
  @@map("batches")
}

model BatchMember {
  batchId       String    @db.Uuid
  customerId    String    @db.Uuid
  enrolledAt    DateTime?
  skippedReason String?

  batch    Batch    @relation(fields: [batchId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@id([batchId, customerId])
  @@index([batchId, enrolledAt])
  @@map("batch_members")
}
```

Replace the `Customer` model with:

```prisma
model Customer {
  id                String         @id @default(uuid()) @db.Uuid
  name              String?
  phoneE164         String         @unique
  email             String?
  location          String?
  status            CustomerStatus @default(NOT_STARTED)
  batchId           String?        @db.Uuid
  optedOutAt        DateTime?
  lastInteractionAt DateTime?
  qualifiedAt       DateTime?
  exportedAt        DateTime?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  batch         Batch?             @relation(fields: [batchId], references: [id])
  batchMembers  BatchMember[]
  conversations Conversation[]
  messages      Message[]
  responses     CustomerResponse[]
  runs          AutomationRun[]
  activityLogs  ActivityLog[]

  @@index([status])
  @@index([qualifiedAt])
  @@index([batchId])
  @@index([exportedAt])
  @@map("customers")
}
```

Replace the `User` model's role relations with a column:

```prisma
model User {
  id              String     @id @default(uuid()) @db.Uuid
  email           String     @unique
  passwordHash    String?
  externalSubject String?    @unique
  displayName     String
  role            RoleCode   @default(VIEWER)
  status          UserStatus @default(ACTIVE)
  lastLoginAt     DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  notifications      Notification[]
  activityLogs       ActivityLog[]
  automationsCreated Automation[]
  batchesCreated     Batch[]

  @@index([status])
  @@map("users")
}
```

Remove `Automation.archivedAt`? No — keep it. Remove from `Automation` only the `campaigns` relation if present. Add `batches Batch[]` to `Automation`.

- [ ] **Step 2: Format and validate**

Run: `npx prisma format && npx prisma validate`
Expected: "The schema at prisma\schema.prisma is valid"

- [ ] **Step 3: Add `mark_qualified` and trim the action union**

In `src/lib/automation/types.ts`, replace the `actionConfig` union with:

```ts
export const actionConfig = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send_message"),
    templateId: z.uuid().optional(),
    body: z.string().max(4000).optional(),
  }),
  z.object({
    action: z.literal("mark_qualified"),
  }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum([
      "NOT_STARTED",
      "IN_FUNNEL",
      "QUALIFIED",
      "NOT_INTERESTED",
      "NO_RESPONSE",
    ]),
  }),
  z.object({
    action: z.literal("add_note"),
    note: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal("stop_journey"),
    reason: z.string().min(1).max(200),
  }),
]);
```

Delete `add_tag`, `remove_tag`, `change_customer_status`, `assign_staff`, `create_follow_up`, `create_call_request`, `create_meeting_request`.

In the same file, trim `conditionConfig`'s enum to the conditions that still have data behind them:

```ts
export const conditionConfig = z.object({
  condition: z.enum([
    "customer_answered_yes",
    "customer_answered_no",
    "customer_did_not_respond",
    "customer_replied",
  ]),
  value: z.string().max(120).optional(),
  thenStepKey: z.string().max(60).optional(),
  elseStepKey: z.string().max(60).optional(),
});
```

- [ ] **Step 4: Trim `executeAction`**

In `src/lib/automation/engine.ts`, replace the whole `executeAction` switch body with:

```ts
  switch (config.action) {
    case "send_message": {
      const result = await sendToCustomer({
        customerId,
        body: config.body,
        templateId: config.templateId,
      });
      return result.ok ? "ok" : "failed";
    }

    case "mark_qualified": {
      // The system's output event. Deliberately its own action rather than a
      // general status change, so it is unmistakable in the audit log.
      await prisma.customer.update({
        where: { id: customerId },
        data: { status: "QUALIFIED", qualifiedAt: new Date() },
      });
      await logActivity({
        eventType: "customer.qualified",
        objectType: "customer",
        objectId: customerId,
        customerId,
        metadata: { by: "automation", runId },
      });
      return "ok";
    }

    case "set_status": {
      await prisma.customer.update({
        where: { id: customerId },
        data: { status: config.status },
      });
      await logActivity({
        eventType: "customer.status_changed",
        objectType: "customer",
        objectId: customerId,
        customerId,
        after: { status: config.status },
        metadata: { by: "automation", runId },
      });
      return "ok";
    }

    case "add_note":
      await logActivity({
        eventType: "customer.note_added",
        objectType: "customer",
        objectId: customerId,
        customerId,
        metadata: { note: config.note, by: "automation", runId },
      });
      return "ok";

    case "stop_journey":
      await stopRun(runId, config.reason);
      return "stopped";
  }
```

Remove the now-unused imports `createCallRequest` and `createMeetingRequest` from the top of the file.

In `evaluateCondition`, delete every `case` that referenced dropped tables (`customer_source`, `customer_campaign`, `customer_has_tag`, `customer_is_interested`, `customer_requested_call`, `customer_requested_meeting`, `follow_up_is_due`, `customer_is_new`, `customer_is_existing`, `customer_status_changed`) and delete the `include` of `source` and `tags` in its customer query.

- [ ] **Step 5: Update the seed**

In `prisma/seed.ts`, delete the permission, role, lead-stage and source seeding blocks entirely. Replace the admin creation with:

```ts
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@3percent.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: "Administrator",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });
```

Replace the settings block with:

```ts
  const settings: Record<string, unknown> = {
    "automation.pause_all": false,
    "automation.no_response_wait_hours": null,   // decision pending
    "numbers.default_country": "IN",             // decided
    "reporting.timezone": null,                  // decision pending
    "optout.keywords": [],                       // decision pending
  };
```

Remove the `ROLE_PERMISSIONS`, `ROLES`, `ROLE_LABELS`, `PERMISSIONS`, `CUSTOMER_SOURCES` and `LEAD_STAGES` imports.

- [ ] **Step 6: Generate and apply the migration**

Run: `npx prisma migrate dev --name qualification_filter`
Expected: migration created and applied; it will report dropped tables.

Then: `npm run db:seed`
Expected: "Seed complete."

- [ ] **Step 7: Fix remaining typecheck errors**

Run: `npm run typecheck`

Expected sites: `src/auth.ts` (roles now a column — return `[user.role]`), `src/lib/session.ts` (select `role` instead of `userRoles`), `src/lib/whatsapp/inbound.ts` (drop the `campaignDelivery.updateMany` call), `src/lib/notifications.ts` (drop dead `notificationHref` cases), `src/app/api/automation/tick/route.ts` (drop the campaign dispatch import — batches come in Task 7; leave only the automation tick for now).

In `src/auth.ts`, the roles line becomes:

```ts
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          roles: [user.role as RoleCode],
        };
```

In `src/lib/session.ts`, the select becomes `{ id: true, email: true, displayName: true, status: true, role: true }` and the return `roles: [account.role as RoleCode]`.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean. `prisma/journeys.test.ts` will now fail — the starter funnel still uses deleted actions. Delete `prisma/journeys.ts` and `prisma/journeys.test.ts` in this step; they are rewritten in Task 4.

```bash
git rm prisma/journeys.ts prisma/journeys.test.ts
```

Remove the journey seeding block from `prisma/seed.ts` as well.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: trim schema to 15 models and add mark_qualified

37 tables become 15. Adds batches and batch_members, replaces the nine
interest statuses with five customer statuses, and collapses the RBAC join
tables to a role column.

mark_qualified is its own action rather than a general status setter, so
the system's output event is unmistakable in the audit log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Builder step model

The conversion between what the builder edits and what the engine reads. Pure, so it is tested directly.

**Files:**
- Create: `src/lib/funnels/steps.ts`, `src/lib/funnels/steps.test.ts`

**Interfaces:**
- Consumes: `actionConfig`, `branchConfig`, `waitConfig` from `src/lib/automation/types.ts`
- Produces:
  - `type BuilderStep`
  - `toEngineSteps(steps: BuilderStep[]): EngineStepInput[]`
  - `fromEngineSteps(rows: EngineStepRow[]): BuilderStep[]`
  - `validateBuilderSteps(steps: BuilderStep[]): string[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/funnels/steps.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  toEngineSteps,
  fromEngineSteps,
  validateBuilderSteps,
  type BuilderStep,
} from "./steps";

const TPL = "11111111-1111-4111-8111-111111111111";

const simple: BuilderStep[] = [
  { kind: "message", key: "s1", templateId: TPL },
  { kind: "wait", key: "s2", days: 1, hours: 0 },
  { kind: "qualify", key: "s3" },
];

test("a linear funnel chains each step to the next", () => {
  const rows = toEngineSteps(simple);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].nextStepKey, "s2");
  assert.equal(rows[1].nextStepKey, "s3");
  // The last step ends the funnel.
  assert.equal(rows[2].nextStepKey, null);
});

test("step kinds map to the engine's own types", () => {
  const rows = toEngineSteps(simple);
  assert.equal(rows[0].stepType, "ACTION");
  assert.equal(rows[1].stepType, "WAIT");
  assert.equal(rows[2].stepType, "ACTION");
  assert.deepEqual(rows[2].config, { action: "mark_qualified" });
});

test("a question becomes a BRANCH and does not use nextStepKey", () => {
  const steps: BuilderStep[] = [
    {
      kind: "question",
      key: "q1",
      templateId: TPL,
      prompt: "Would you like to know more?",
      questionKey: "wants_more",
      yesKey: "y1",
      noKey: "n1",
      otherKey: "n1",
    },
    { kind: "qualify", key: "y1" },
    { kind: "message", key: "n1", templateId: TPL },
  ];

  const rows = toEngineSteps(steps);
  const q = rows[0];
  assert.equal(q.stepType, "BRANCH");
  // Branch targets are explicit, so an implicit "next" would be a second,
  // conflicting path out of the same step.
  assert.equal(q.nextStepKey, null);

  const cfg = q.config as { answers: Record<string, string>; otherStepKey: string };
  assert.deepEqual(cfg.answers, { YES: "y1", NO: "n1" });
  assert.equal(cfg.otherStepKey, "n1");
});

test("sortOrder is stable and ten apart, leaving room to insert", () => {
  const rows = toEngineSteps(simple);
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 10, 20]);
});

test("a round trip through the engine shape preserves the builder steps", () => {
  const rows = toEngineSteps(simple).map((r) => ({ ...r, version: 1 }));
  assert.deepEqual(fromEngineSteps(rows), simple);
});

test("validation rejects a funnel with no qualify step", () => {
  const problems = validateBuilderSteps([
    { kind: "message", key: "s1", templateId: TPL },
  ]);
  assert.ok(problems.some((p) => /qualify/i.test(p)));
});

test("validation rejects a branch pointing at a missing step", () => {
  const problems = validateBuilderSteps([
    {
      kind: "question",
      key: "q1",
      templateId: TPL,
      prompt: "?",
      questionKey: "k",
      yesKey: "nope",
      noKey: null,
      otherKey: null,
    },
    { kind: "qualify", key: "z" },
  ]);
  assert.ok(problems.some((p) => /nope/.test(p)));
});

test("validation rejects duplicate step keys", () => {
  const problems = validateBuilderSteps([
    { kind: "message", key: "dup", templateId: TPL },
    { kind: "qualify", key: "dup" },
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p)));
});

test("validation rejects a zero-length wait", () => {
  const problems = validateBuilderSteps([
    { kind: "wait", key: "w", days: 0, hours: 0 },
    { kind: "qualify", key: "q" },
  ]);
  assert.ok(problems.some((p) => /zero/i.test(p)));
});

test("an empty funnel is rejected", () => {
  assert.ok(validateBuilderSteps([]).length > 0);
});

test("a stop step terminates and carries its reason", () => {
  const rows = toEngineSteps([
    { kind: "qualify", key: "q" },
    { kind: "stop", key: "end", reason: "done" },
  ]);
  assert.equal(rows[1].stepType, "ACTION");
  assert.deepEqual(rows[1].config, { action: "stop_journey", reason: "done" });
  assert.equal(rows[1].nextStepKey, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/funnels/steps.test.ts`
Expected: FAIL — `Cannot find module './steps'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/funnels/steps.ts`:

```ts
/**
 * The builder edits an ordered list. The engine reads a graph.
 *
 * This module is the only place that converts between the two, so the builder
 * never has to know about step types, and the engine never has to know a list
 * existed.
 */

export type BuilderStep =
  | { kind: "message"; key: string; templateId: string }
  | { kind: "wait"; key: string; days: number; hours: number }
  | { kind: "qualify"; key: string }
  | { kind: "stop"; key: string; reason: string }
  | {
      kind: "question";
      key: string;
      templateId: string;
      prompt: string;
      questionKey: string;
      yesKey: string | null;
      noKey: string | null;
      otherKey: string | null;
    };

export type EngineStepInput = {
  stepKey: string;
  stepType: "ACTION" | "WAIT" | "BRANCH";
  config: unknown;
  nextStepKey: string | null;
  sortOrder: number;
};

export type EngineStepRow = EngineStepInput & { version?: number };

/** Ten apart so a step can be inserted without renumbering everything. */
const STRIDE = 10;

export function toEngineSteps(steps: BuilderStep[]): EngineStepInput[] {
  return steps.map((step, i) => {
    const next = steps[i + 1]?.key ?? null;
    const sortOrder = i * STRIDE;

    switch (step.kind) {
      case "message":
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "send_message", templateId: step.templateId },
          nextStepKey: next,
          sortOrder,
        };

      case "wait":
        return {
          stepKey: step.key,
          stepType: "WAIT",
          config: { days: step.days, hours: step.hours },
          nextStepKey: next,
          sortOrder,
        };

      case "qualify":
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "mark_qualified" },
          nextStepKey: next,
          sortOrder,
        };

      case "stop":
        // Terminates the branch. A linear list needs an explicit terminator,
        // or two terminal paths fall through into one another.
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "stop_journey", reason: step.reason },
          nextStepKey: null,
          sortOrder,
        };

      case "question": {
        const answers: Record<string, string> = {};
        if (step.yesKey) answers.YES = step.yesKey;
        if (step.noKey) answers.NO = step.noKey;
        return {
          stepKey: step.key,
          stepType: "BRANCH",
          config: {
            questionKey: step.questionKey,
            prompt: step.prompt,
            templateId: step.templateId,
            answers,
            ...(step.otherKey ? { otherStepKey: step.otherKey } : {}),
          },
          // A branch's exits are its answers. An implicit next would be a
          // second path out of the same step.
          nextStepKey: null,
          sortOrder,
        };
      }
    }
  });
}

export function fromEngineSteps(rows: EngineStepRow[]): BuilderStep[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row): BuilderStep => {
      if (row.stepType === "WAIT") {
        const c = row.config as { days?: number; hours?: number };
        return {
          kind: "wait",
          key: row.stepKey,
          days: c.days ?? 0,
          hours: c.hours ?? 0,
        };
      }

      if (row.stepType === "BRANCH") {
        const c = row.config as {
          questionKey: string;
          prompt: string;
          templateId?: string;
          answers?: Record<string, string>;
          otherStepKey?: string;
        };
        return {
          kind: "question",
          key: row.stepKey,
          templateId: c.templateId ?? "",
          prompt: c.prompt,
          questionKey: c.questionKey,
          yesKey: c.answers?.YES ?? null,
          noKey: c.answers?.NO ?? null,
          otherKey: c.otherStepKey ?? null,
        };
      }

      const c = row.config as { action: string; templateId?: string; reason?: string };
      if (c.action === "mark_qualified") {
        return { kind: "qualify", key: row.stepKey };
      }
      if (c.action === "stop_journey") {
        return { kind: "stop", key: row.stepKey, reason: c.reason ?? "" };
      }
      return {
        kind: "message",
        key: row.stepKey,
        templateId: c.templateId ?? "",
      };
    });
}

export function validateBuilderSteps(steps: BuilderStep[]): string[] {
  const problems: string[] = [];

  if (steps.length === 0) {
    problems.push("The funnel has no steps.");
    return problems;
  }

  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) {
      problems.push(`Duplicate step key "${step.key}".`);
    }
    keys.add(step.key);
  }

  // A funnel that cannot qualify anyone produces nothing.
  if (!steps.some((s) => s.kind === "qualify")) {
    problems.push(
      'The funnel has no "Mark qualified" step, so it can never produce an output.',
    );
  }

  for (const step of steps) {
    if (step.kind === "wait" && step.days === 0 && step.hours === 0) {
      problems.push(`Step "${step.key}" waits for zero time.`);
    }

    if (step.kind === "question") {
      if (!step.yesKey && !step.noKey) {
        problems.push(`Question "${step.key}" has no answers wired up.`);
      }
      for (const [label, target] of [
        ["YES", step.yesKey],
        ["NO", step.noKey],
        ["unrecognised reply", step.otherKey],
      ] as const) {
        if (target && !keys.has(target)) {
          problems.push(
            `Question "${step.key}" sends ${label} to "${target}", which does not exist.`,
          );
        }
      }
      if (!step.prompt.trim()) {
        problems.push(`Question "${step.key}" has no prompt text.`);
      }
    }

    if ((step.kind === "message" || step.kind === "question") && !step.templateId) {
      problems.push(`Step "${step.key}" has no template selected.`);
    }
  }

  return problems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/funnels/steps.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/lib/funnels
git commit -m "feat: builder step model with engine conversion

The builder edits an ordered list; the engine reads a graph. This is the
only place that converts between them, so neither has to know about the
other's shape. Branch steps carry their exits in their answers and get a
null nextStepKey, because an implicit next would be a second path out of
the same step.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Starter funnel and validation rule

**Files:**
- Create: `prisma/starter-funnel.ts`
- Modify: `src/lib/automation/validate.ts`, `prisma/seed.ts`
- Test: `prisma/starter-funnel.test.ts`

**Interfaces:**
- Consumes: `BuilderStep`, `toEngineSteps`, `validateBuilderSteps` from Task 4.
- Produces: `STARTER_FUNNEL: { name, type, description, steps: BuilderStep[] }`

- [ ] **Step 1: Write the failing test**

Create `prisma/starter-funnel.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_FUNNEL } from "./starter-funnel";
import { validateBuilderSteps, toEngineSteps } from "../src/lib/funnels/steps";

test("the starter funnel is valid", () => {
  assert.deepEqual(validateBuilderSteps(STARTER_FUNNEL.steps), []);
});

test("it ends by qualifying someone", () => {
  assert.ok(STARTER_FUNNEL.steps.some((s) => s.kind === "qualify"));
});

test("saying no never leads to being qualified", () => {
  const byKey = new Map(STARTER_FUNNEL.steps.map((s) => [s.key, s]));
  const question = STARTER_FUNNEL.steps.find((s) => s.kind === "question");
  assert.ok(question && question.kind === "question");

  // Walk the NO path and assert it cannot reach a qualify step.
  const seen = new Set<string>();
  const queue = [question.noKey].filter(Boolean) as string[];
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const step = byKey.get(key);
    assert.ok(step, `step ${key} exists`);
    assert.notEqual(step!.kind, "qualify", `NO path must not qualify (${key})`);
    if (step!.kind === "question") {
      for (const t of [step!.yesKey, step!.noKey, step!.otherKey]) {
        if (t) queue.push(t);
      }
    }
  }
});

test("it converts to engine steps without throwing", () => {
  const rows = toEngineSteps(STARTER_FUNNEL.steps);
  assert.equal(rows.length, STARTER_FUNNEL.steps.length);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test prisma/starter-funnel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the starter funnel**

Create `prisma/starter-funnel.ts`:

```ts
import type { BuilderStep } from "../src/lib/funnels/steps";

/**
 * A worked example, not an approved script. The message copy is placeholder
 * text — real business-initiated WhatsApp messages must use provider-approved
 * templates, so `templateId` is filled in by the seed.
 *
 * Both terminal paths end in an explicit stop. Without one, the qualified
 * branch would fall through into the declined branch by list order.
 */
export const STARTER_FUNNEL: {
  name: string;
  type: "INTRODUCTION";
  description: string;
  steps: BuilderStep[];
} = {
  name: "Starter funnel",
  type: "INTRODUCTION",
  description: "Introduces the offer, asks two questions, qualifies the yeses.",
  steps: [
    { kind: "message", key: "intro", templateId: "" },
    {
      kind: "question",
      key: "ask_more",
      templateId: "",
      prompt: "Would you like to know more? Reply YES or NO.",
      questionKey: "wants_more_info",
      yesKey: "details",
      noKey: "declined",
      otherKey: "declined",
    },
    { kind: "message", key: "details", templateId: "" },
    {
      kind: "question",
      key: "ask_call",
      templateId: "",
      prompt: "Would you like someone to call you? Reply YES or NO.",
      questionKey: "wants_call",
      yesKey: "qualified",
      noKey: "declined",
      otherKey: "declined",
    },
    { kind: "qualify", key: "qualified" },
    { kind: "stop", key: "end_qualified", reason: "qualified for the CRM team" },
    { kind: "message", key: "declined", templateId: "" },
    { kind: "stop", key: "end_declined", reason: "not interested" },
  ],
};
```

- [ ] **Step 4: Add the validation rule**

In `src/lib/automation/validate.ts`, after the reachability check, add:

```ts
  // A funnel that cannot qualify anyone has no output, which is almost
  // certainly a mistake rather than an intent.
  const qualifies = steps.some((step) => {
    const parsed = actionConfig.safeParse(step.config);
    return parsed.success && parsed.data.action === "mark_qualified";
  });
  if (!qualifies) {
    problems.push(
      'the funnel has no "Mark qualified" step, so it can never produce an output',
    );
  }
```

- [ ] **Step 5: Seed the starter funnel**

In `prisma/seed.ts`, after the admin user, add:

```ts
  // One template per message step, so the starter funnel is usable immediately.
  const introTemplate = await prisma.template.upsert({
    where: { name: "Starter — introduction" },
    update: {},
    create: {
      name: "Starter — introduction",
      category: "Starter",
      body: "Hello {{name}}, thanks for your interest. May we tell you more?",
    },
  });

  const existing = await prisma.automation.findFirst({
    where: { name: STARTER_FUNNEL.name },
    select: { id: true },
  });

  if (!existing) {
    const withTemplate = STARTER_FUNNEL.steps.map((s) =>
      s.kind === "message" || s.kind === "question"
        ? { ...s, templateId: introTemplate.id }
        : s,
    );
    await prisma.automation.create({
      data: {
        name: STARTER_FUNNEL.name,
        type: STARTER_FUNNEL.type,
        status: "DRAFT",
        version: 1,
        description: STARTER_FUNNEL.description,
        createdById: admin.id,
        steps: {
          create: toEngineSteps(withTemplate).map((r) => ({
            version: 1,
            stepKey: r.stepKey,
            stepType: r.stepType,
            config: r.config as never,
            nextStepKey: r.nextStepKey,
            sortOrder: r.sortOrder,
          })),
        },
      },
    });
  }
```

Add imports at the top of `prisma/seed.ts`:

```ts
import { STARTER_FUNNEL } from "./starter-funnel";
import { toEngineSteps } from "../src/lib/funnels/steps";
```

- [ ] **Step 6: Verify**

Run: `npx tsx --test prisma/starter-funnel.test.ts src/lib/funnels/steps.test.ts`
Expected: PASS

Run: `npm run db:seed && npm run typecheck && npm test`
Expected: seed reports the funnel created; all clean

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: starter funnel and the must-qualify validation rule

Adds a stop step kind, because a linear list cannot otherwise express two
terminal branches without one falling through into the other.

Activation now requires at least one Mark qualified step. A funnel that
cannot qualify anyone produces nothing, which is a mistake rather than a
choice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Funnel builder UI

**Files:**
- Create: `src/app/(app)/funnels/page.tsx`, `src/app/(app)/funnels/[id]/page.tsx`, `src/app/(app)/funnels/[id]/builder.tsx`, `src/app/(app)/funnels/actions.ts`
- Delete: `src/app/(app)/automations` (replaced by funnels)

**Interfaces:**
- Consumes: `BuilderStep`, `toEngineSteps`, `fromEngineSteps`, `validateBuilderSteps`; `validateAutomation` from `src/lib/automation/validate.ts`
- Produces: server actions `saveFunnel`, `activateFunnel`, `createFunnel`

- [ ] **Step 1: Write `src/app/(app)/funnels/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";
import { validateAutomation } from "@/lib/automation/validate";
import {
  toEngineSteps,
  validateBuilderSteps,
  type BuilderStep,
} from "@/lib/funnels/steps";

export type FunnelState = { error?: string; problems?: string[]; saved?: boolean };

const builderStep: z.ZodType<BuilderStep> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), key: z.string().min(1), templateId: z.string() }),
  z.object({
    kind: z.literal("wait"),
    key: z.string().min(1),
    days: z.number().int().min(0).max(365),
    hours: z.number().int().min(0).max(23),
  }),
  z.object({ kind: z.literal("qualify"), key: z.string().min(1) }),
  z.object({ kind: z.literal("stop"), key: z.string().min(1), reason: z.string().max(200) }),
  z.object({
    kind: z.literal("question"),
    key: z.string().min(1),
    templateId: z.string(),
    prompt: z.string().max(4000),
    questionKey: z.string().min(1).max(60),
    yesKey: z.string().nullable(),
    noKey: z.string().nullable(),
    otherKey: z.string().nullable(),
  }),
]) as z.ZodType<BuilderStep>;

export async function createFunnel(formData: FormData) {
  const user = await assertPermission("funnel:manage");
  const name = String(formData.get("name") ?? "").trim() || "Untitled funnel";

  const funnel = await prisma.automation.create({
    data: { name, type: "CUSTOM", status: "DRAFT", version: 1, createdById: user.id },
    select: { id: true },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.created",
    objectType: "automation",
    objectId: funnel.id,
    after: { name },
  });

  redirect(`/funnels/${funnel.id}`);
}

/**
 * Save the step list.
 *
 * Editing a DRAFT edits in place. Editing an ACTIVE funnel creates a new
 * version, because runs already in flight pin their own version and must not
 * have the ground shift under them mid-journey.
 */
export async function saveFunnel(
  _prev: FunnelState,
  formData: FormData,
): Promise<FunnelState> {
  const user = await assertPermission("funnel:manage");

  const id = z.uuid().parse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the funnel a name." };

  const parsed = z.array(builderStep).safeParse(JSON.parse(String(formData.get("steps") ?? "[]")));
  if (!parsed.success) return { error: "The funnel could not be read." };

  const problems = validateBuilderSteps(parsed.data);
  if (problems.length > 0) return { problems };

  const funnel = await prisma.automation.findUnique({
    where: { id },
    select: { id: true, status: true, version: true },
  });
  if (!funnel) return { error: "Funnel not found." };

  const version = funnel.status === "ACTIVE" ? funnel.version + 1 : funnel.version;
  const rows = toEngineSteps(parsed.data);

  await prisma.$transaction(async (tx) => {
    if (version === funnel.version) {
      await tx.automationStep.deleteMany({ where: { automationId: id, version } });
    }
    await tx.automationStep.createMany({
      data: rows.map((r) => ({
        automationId: id,
        version,
        stepKey: r.stepKey,
        stepType: r.stepType,
        config: r.config as never,
        nextStepKey: r.nextStepKey,
        sortOrder: r.sortOrder,
      })),
    });
    await tx.automation.update({ where: { id }, data: { name, version } });
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.saved",
    objectType: "automation",
    objectId: id,
    after: { name, version, steps: rows.length },
  });

  revalidatePath(`/funnels/${id}`);
  revalidatePath("/funnels");
  return { saved: true };
}

export async function activateFunnel(
  _prev: FunnelState,
  formData: FormData,
): Promise<FunnelState> {
  const user = await assertPermission("funnel:manage");
  const id = z.uuid().parse(formData.get("id"));

  const problems = await validateAutomation(id);
  if (problems.length > 0) return { problems };

  await prisma.automation.update({
    where: { id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.activated",
    objectType: "automation",
    objectId: id,
  });

  revalidatePath(`/funnels/${id}`);
  revalidatePath("/funnels");
  return { saved: true };
}
```

- [ ] **Step 2: Write the funnel list page**

Create `src/app/(app)/funnels/page.tsx` — a table of `prisma.automation.findMany({ where: { archivedAt: null } })` showing name, status badge, step count (`_count.steps`), and running batches count. Include a "New funnel" form posting to `createFunnel`. Guard with `requirePermission("funnel:read")`; show the create form only when `can(user.roles, "funnel:manage")`.

- [ ] **Step 3: Write the builder page and client component**

`src/app/(app)/funnels/[id]/page.tsx` loads the funnel, its steps at the current version, the active templates, and `validateAutomation(id)`, then renders `<Builder />` plus the validation report.

`src/app/(app)/funnels/[id]/builder.tsx` is a client component holding `useState<BuilderStep[]>`, with:
- an "Add step" row of four buttons: Message, Question, Wait, Mark qualified, Stop
- each step rendered as a card with its own fields and up/down/remove controls
- question steps get three `<select>`s listing the other steps' keys, for YES / NO / unrecognised
- new keys generated as `s${Date.now().toString(36)}` so they are stable and unique
- the whole list serialised into a hidden `steps` input as JSON on submit

- [ ] **Step 4: Remove the old automations screens**

```bash
git rm -r "src/app/(app)/automations"
```

Move the pause-all control into Settings (it already exists there).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build && npx eslint src prisma --max-warnings=0`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: funnel builder

Editing an ACTIVE funnel creates a new version rather than mutating the
current one, because runs already in flight pin their version and must not
have the ground shift under them mid-journey.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Batch runner

**Files:**
- Create: `src/lib/batches/runner.ts`
- Modify: `src/app/api/automation/tick/route.ts`

**Interfaces:**
- Consumes: `enrolCustomer` from `src/lib/automation/entry.ts`
- Produces:
  - `startBatch(batchId: string): Promise<{ enrolled: number }>`
  - `dispatchBatch(batchId: string, limit?: number): Promise<DispatchResult>`
  - `dispatchRunningBatches(): Promise<DispatchResult[]>`
  - `batchProgress(batchId: string): Promise<Record<string, number>>`

- [ ] **Step 1: Write `src/lib/batches/runner.ts`**

```ts
import "server-only";
import { logActivity } from "@/lib/activity";
import { enrolCustomer } from "@/lib/automation/entry";
import { prisma } from "@/lib/prisma";

/**
 * A batch is a frozen list of numbers against one version of one funnel.
 *
 * Members are enrolled in slices rather than all at once, so a large upload
 * does not hold a single request open, and a stop takes effect between slices.
 */

const SLICE = 50;

export type DispatchResult = {
  batchId: string;
  enrolled: number;
  skipped: number;
  remaining: number;
  stopped: boolean;
};

export async function startBatch(batchId: string): Promise<{ enrolled: number }> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, name: true, automationId: true },
  });
  if (!batch || batch.status !== "DRAFT") return { enrolled: 0 };

  await prisma.batch.update({
    where: { id: batchId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  await logActivity({
    eventType: "batch.started",
    objectType: "batch",
    objectId: batchId,
    metadata: { name: batch.name },
  });

  const result = await dispatchBatch(batchId);
  return { enrolled: result.enrolled };
}

export async function dispatchBatch(
  batchId: string,
  limit = SLICE,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    batchId,
    enrolled: 0,
    skipped: 0,
    remaining: 0,
    stopped: false,
  };

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, automationId: true, name: true },
  });
  if (!batch || batch.status !== "RUNNING") {
    result.stopped = true;
    return result;
  }

  const pending = await prisma.batchMember.findMany({
    where: { batchId, enrolledAt: null, skippedReason: null },
    take: limit,
    select: { customerId: true },
  });

  for (const { customerId } of pending) {
    // Re-read status before each enrolment so a stop lands immediately
    // rather than at the end of the slice.
    const current = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (current?.status !== "RUNNING") {
      result.stopped = true;
      break;
    }

    const enrolled = await enrolCustomer({
      automationId: batch.automationId,
      customerId,
    });

    if (enrolled.ok) {
      await prisma.$transaction([
        prisma.batchMember.update({
          where: { batchId_customerId: { batchId, customerId } },
          data: { enrolledAt: new Date() },
        }),
        prisma.customer.update({
          where: { id: customerId },
          data: { status: "IN_FUNNEL" },
        }),
      ]);
      result.enrolled++;
    } else {
      await prisma.batchMember.update({
        where: { batchId_customerId: { batchId, customerId } },
        data: { skippedReason: enrolled.reason },
      });
      result.skipped++;
    }
  }

  result.remaining = await prisma.batchMember.count({
    where: { batchId, enrolledAt: null, skippedReason: null },
  });

  if (result.remaining === 0 && !result.stopped) {
    await prisma.batch.updateMany({
      where: { id: batchId, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await logActivity({
      eventType: "batch.completed",
      objectType: "batch",
      objectId: batchId,
      metadata: { name: batch.name },
    });
  }

  return result;
}

export async function dispatchRunningBatches(): Promise<DispatchResult[]> {
  const running = await prisma.batch.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  const results: DispatchResult[] = [];
  for (const b of running) results.push(await dispatchBatch(b.id));
  return results;
}

/** Counts by customer status for one batch. */
export async function batchProgress(batchId: string) {
  const rows = await prisma.customer.groupBy({
    by: ["status"],
    where: { batchMembers: { some: { batchId } } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {
    NOT_STARTED: 0,
    IN_FUNNEL: 0,
    QUALIFIED: 0,
    NOT_INTERESTED: 0,
    NO_RESPONSE: 0,
  };
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}
```

- [ ] **Step 2: Wire into the tick endpoint**

In `src/app/api/automation/tick/route.ts`, replace the campaign import and call:

```ts
import { dispatchRunningBatches } from "@/lib/batches/runner";
```

```ts
    const automations = await tick();
    const batches = await dispatchRunningBatches();
    return NextResponse.json({ automations, batches });
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run build`

```bash
git add -A
git commit -m "feat: batch runner

Members enrol in slices, and batch status is re-read before each enrolment
so a stop takes effect immediately rather than at the end of a slice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Number upload and batch screens

**Files:**
- Create: `src/lib/numbers/parse-list.ts`, `src/lib/numbers/parse-list.test.ts`, `src/app/(app)/batches/page.tsx`, `src/app/(app)/batches/new/page.tsx`, `src/app/(app)/batches/new/upload-form.tsx`, `src/app/(app)/batches/[id]/page.tsx`, `src/app/(app)/batches/actions.ts`

**Interfaces:**
- Consumes: `parsePhone` (Task 1), `startBatch`, `batchProgress` (Task 7)
- Produces: `parseNumberList(text: string): ParseSummary`

- [ ] **Step 1: Write the failing test**

Create `src/lib/numbers/parse-list.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberList } from "./parse-list";

test("bare numbers, one per line", () => {
  const s = parseNumberList("9876543210\n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.rejected.length, 0);
  assert.equal(s.assumedCountryCount, 2);
});

test("name and phone, comma separated", () => {
  const s = parseNumberList("Priya,9876543210\nRahul, 9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.valid[0].name, "Priya");
  assert.equal(s.valid[1].name, "Rahul");
  assert.equal(s.valid[1].e164, "+919876543211");
});

test("a header row is ignored", () => {
  const s = parseNumberList("name,phone\nPriya,9876543210");
  assert.equal(s.valid.length, 1);
  assert.equal(s.rejected.length, 0);
});

test("duplicates within the file are collapsed and counted", () => {
  const s = parseNumberList("9876543210\n9876543210\n98765 43210");
  assert.equal(s.valid.length, 1);
  assert.equal(s.duplicateCount, 2);
});

test("rejected rows carry their line number and reason", () => {
  const s = parseNumberList("9876543210\n1234567890\nabc");
  assert.equal(s.valid.length, 1);
  assert.equal(s.rejected.length, 2);
  assert.equal(s.rejected[0].row, 2);
  assert.ok(s.rejected[0].reason.length > 0);
  assert.equal(s.rejected[1].row, 3);
});

test("blank lines are skipped without being rejected", () => {
  const s = parseNumberList("9876543210\n\n   \n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.rejected.length, 0);
});

test("explicit country codes are not counted as assumed", () => {
  const s = parseNumberList("+919876543210\n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.assumedCountryCount, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/numbers/parse-list.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/numbers/parse-list.ts`:

```ts
import { parsePhone } from "@/lib/phone";

export type ValidRow = { row: number; name: string | null; e164: string; assumed: boolean };
export type RejectedRow = { row: number; raw: string; reason: string };

export type ParseSummary = {
  valid: ValidRow[];
  rejected: RejectedRow[];
  duplicateCount: number;
  assumedCountryCount: number;
};

const HEADER = /^(name|full ?name)?\s*,?\s*(phone|mobile|number|contact)/i;

export function parseNumberList(text: string): ParseSummary {
  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  const lines = (text ?? "").split(/\r?\n/);

  lines.forEach((line, i) => {
    const row = i + 1;
    const trimmed = line.trim();
    if (trimmed === "") return;
    if (row === 1 && HEADER.test(trimmed)) return;

    let name: string | null = null;
    let phoneRaw = trimmed;

    if (trimmed.includes(",")) {
      const parts = trimmed.split(",");
      // The phone is the last field; everything before it is the name.
      phoneRaw = parts[parts.length - 1].trim();
      const namePart = parts.slice(0, -1).join(",").trim();
      name = namePart === "" ? null : namePart;
    }

    const parsed = parsePhone(phoneRaw);
    if (!parsed.ok) {
      rejected.push({ row, raw: trimmed, reason: parsed.reason });
      return;
    }

    if (seen.has(parsed.e164)) {
      duplicateCount++;
      return;
    }
    seen.add(parsed.e164);

    valid.push({ row, name, e164: parsed.e164, assumed: parsed.assumedCountry });
  });

  return {
    valid,
    rejected,
    duplicateCount,
    assumedCountryCount: valid.filter((v) => v.assumed).length,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test src/lib/numbers/parse-list.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Write `src/app/(app)/batches/actions.ts`**

Server actions: `previewNumbers` (returns a `ParseSummary` for the review screen), `createBatch` (creates the batch, upserts customers by `phoneE164`, creates `batch_members`, marking opted-out numbers as skipped), `startBatchAction`, `setBatchStatus`.

`createBatch` must:
- take `name`, `automationId`, and the pasted text
- refuse if the chosen funnel is not `ACTIVE`
- freeze `automationVersion` from the funnel's current version
- upsert each valid number: `prisma.customer.upsert({ where: { phoneE164 }, update: { name }, create: { phoneE164, name, batchId } })`
- create a `batchMember` per customer, with `skippedReason: "opted out"` where `optedOutAt` is set

- [ ] **Step 6: Write the three screens**

- `batches/page.tsx` — list with status, member count, qualified count, progress
- `batches/new/page.tsx` + `upload-form.tsx` — funnel picker, name field, textarea for paste plus a file input reading a CSV client-side into the same textarea; a "Check numbers" button calling `previewNumbers`; the review panel showing **valid / rejected (with row numbers and reasons) / duplicates / how many had +91 assumed**; a "Start batch" button that is disabled until a preview has been run
- `batches/[id]/page.tsx` — `batchProgress()` counts as stat tiles, member table, pause/stop controls

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm test && npm run build && npx eslint src prisma --max-warnings=0`

```bash
git add -A
git commit -m "feat: number upload and batch screens

The review screen reports how many numbers had +91 assumed. That is the one
step that can message the wrong person, so it is stated before sending
rather than buried.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Qualified list and CSV export

**Files:**
- Create: `src/app/(app)/qualified/page.tsx`, `src/app/(app)/qualified/actions.ts`, `src/app/api/qualified/export/route.ts`

- [ ] **Step 1: Write the export route**

Create `src/app/api/qualified/export/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Escape a CSV field. A name containing a comma or quote must not shift columns. */
function csv(value: string | null | undefined): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(request: NextRequest) {
  const user = await requirePermission("qualified:export");

  const unexportedOnly = request.nextUrl.searchParams.get("new") === "1";
  const batchId = request.nextUrl.searchParams.get("batch");

  const rows = await prisma.customer.findMany({
    where: {
      status: "QUALIFIED",
      ...(unexportedOnly && { exportedAt: null }),
      ...(batchId && { batchId }),
    },
    orderBy: { qualifiedAt: "asc" },
    include: { batch: { select: { name: true, automation: { select: { name: true } } } } },
  });

  const header = "name,phone,qualified_at,batch,funnel";
  const body = rows
    .map((r) =>
      [
        csv(r.name),
        csv(r.phoneE164),
        csv(r.qualifiedAt?.toISOString() ?? ""),
        csv(r.batch?.name ?? ""),
        csv(r.batch?.automation.name ?? ""),
      ].join(","),
    )
    .join("\n");

  // Stamp what left the building, so the next export can exclude it and the
  // CRM team never receives the same number twice.
  if (rows.length > 0) {
    await prisma.customer.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { exportedAt: new Date() },
    });
    await logActivity({
      actorUserId: user.id,
      eventType: "qualified.exported",
      objectType: "export",
      metadata: { count: rows.length, unexportedOnly, batchId },
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qualified-${stamp}.csv"`,
    },
  });
}
```

- [ ] **Step 2: Write the qualified page**

`src/app/(app)/qualified/page.tsx` — guard with `requirePermission("qualified:read")`. Table of qualified customers: name, phone, qualified at, batch, funnel, exported at. Filters: batch dropdown, "not yet exported" checkbox. Two download links: `/api/qualified/export?new=1` ("Export new only") and `/api/qualified/export` ("Export all"), shown only with `qualified:export`.

Above the table, a stat row: total qualified, exported, not yet exported.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run build`

Manual check: sign in, visit `/qualified`, click "Export all", confirm a CSV downloads and `exportedAt` is stamped.

```bash
git add -A
git commit -m "feat: qualified list and CSV export

Exporting stamps exportedAt so the next 'new only' export excludes those
rows. The CRM team receiving the same number twice is the failure this
guards against.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Settings, docs and final verification

**Files:**
- Modify: `src/lib/setting-specs.ts`, `README.md`, `PROGRESS.md`, `BUSINESS-OVERVIEW.md`
- Delete: `PRODUCTION.md` sections that describe removed modules

- [ ] **Step 1: Update the settings specs**

In `src/lib/setting-specs.ts`, remove `followup.sla_hours`, `customer.status_values`, `meeting.status_values`, `outcome.values`, `customer.type_values`. Add:

```ts
  {
    key: "numbers.default_country",
    label: "Default country for bare numbers",
    gap: "Decided",
    type: "text",
    help: 'Two-letter code. Numbers without a country code are completed with this. Currently only "IN" is supported.',
    whileUnset:
      "Numbers without a country code are rejected instead of being completed.",
  },
```

Keep `automation.no_response_wait_hours`, `reporting.timezone`, `optout.keywords`, `messaging.send_window`.

- [ ] **Step 2: Update the documentation**

- `README.md` — replace the phase table with the six screens and the new flow
- `PROGRESS.md` — add a section recording the rescope, pointing at the spec
- `BUSINESS-OVERVIEW.md` — rewrite for the filter, not the CRM
- Republish the artifact at its existing URL with the updated content

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm test
npm run build
npx eslint src prisma --max-warnings=0
npx prisma validate
```

Expected: all clean.

- [ ] **Step 4: End-to-end smoke test against the live database**

1. `npm run dev`
2. Sign in as `admin@3percent.local`
3. `/funnels` — open the starter funnel, confirm the builder loads its steps, activate it (expect it to be blocked until `automation.no_response_wait_hours` is set if any question has a timeout)
4. `/batches/new` — paste `Test,9876543210` and a deliberately bad row `1234567890`; confirm the review reports 1 valid, 1 rejected with a reason, and 1 assumed +91
5. Start the batch; confirm the member enrols and status becomes `IN_FUNNEL`
6. `/qualified` — empty; export returns a header-only CSV
7. Stop the server

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: update for the qualification filter scope

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §4 reused unchanged | Tasks 3, 7 (engine trimmed only where tables were dropped) |
| §5 data model | Task 3 |
| §5 roles | Task 2 (rbac), Task 3 (schema) |
| §6 funnel builder | Tasks 4, 5, 6 |
| §6 versioning on edit | Task 6, `saveFunnel` |
| §6 must-qualify validation | Task 5 |
| §7 qualified list + export + `exportedAt` | Task 9 |
| §8 screens | Tasks 6, 8, 9, 10 |
| §9 number parsing, India default | Tasks 1, 8 |
| §9 review before start | Task 8 |
| §10 migration plan | Tasks 2, 3 |
| §11 open decisions | Task 10 (settings) |
| §13 version control | Done before this plan — commit `5dc1dd9` |

**Known gap accepted:** the inbox survives Task 2 largely unchanged and is
never given its own task. It already works, and trimming it further is not
required by the spec.
