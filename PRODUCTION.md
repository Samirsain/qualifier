# Production Readiness

Honest assessment against `16_3_Percent_Club_Deployment_Release.md` §11 and
`11_3_Percent_Club_Security.md` §15.

**Verdict: not production ready.** The blockers are business decisions and
operational infrastructure, not missing features. This file lists exactly what
stands between the current build and a safe launch.

---

## 1. Loopholes found and fixed

These were real defects in the build, found by auditing against the docs and by
running the app. All are fixed and covered by tests.

### S1 — the webhook accepted unsigned requests

`WHATSAPP_PROVIDER` defaults to `mock`, and the mock adapter's `verifyWebhook`
returned `true` for any POST. Anyone who knew the URL could inject inbound
messages, which advance automations and cause **real outbound WhatsApp sends**.
Doc 15 §6 classes that as S1: uncontrolled customer messaging, security bypass.

Fixed: the mock now requires an HMAC signature using `WHATSAPP_VERIFY_TOKEN`,
the same shape the real provider uses. Verified live — unsigned POST now returns
403, correctly signed returns 200.

### S1 — a disabled account kept working

Sessions are JWTs and nothing re-checked the database, so suspending a user left
their session valid until the token expired. Doc 11 §7 requires session
revocation for disabled users, and §3 requires roles to be authoritative
server-side.

Fixed: `currentUser()` re-reads status **and roles** from the database on every
request, so a revoked role or a suspended account takes effect immediately.
Verified live: active → 200, suspended → redirected, re-enabled → 200.

### S2 — a branch timeout re-armed itself forever

When an automation question timed out, the run woke, hit the same branch, found
the "already asked" idempotency key, and re-parked with a *fresh* timeout. The
no-response branch would never have fired. BR-14 / F-007 would have failed
silently in production.

Fixed in `engine.ts`: arriving at an already-asked branch now means the timeout
fired, so it routes to `timeoutStepKey` and records `question.timeout`.

### S2 — validation passed a journey that could never run

The 3% Club journey validated clean while its no-response wait was unset, so it
could be activated — and its no-response branch would have been inert. Doc 07
§16 requires empty waits to be caught; the check covered WAIT steps but not
branch timeouts.

Fixed in `validate.ts`. The wait itself now lives on the question — "if there is
no reply for N days, go to this step" — so the builder cannot save a funnel that
parks a silent number forever, and no hidden setting has to be decided first.

### S3 — a database outage looked like a wrong password

Any `AuthError` produced "Incorrect email or password", so an infrastructure
failure sent operators hunting the wrong problem, with nothing in the logs.

Fixed: genuine credential failures still show the generic message; anything else
shows "Sign-in is temporarily unavailable" and logs the error type server-side
(doc 11 §8 — generic outside, detailed inside).

---

## 2. Hardening added

| Control | Where | Doc |
|---|---|---|
| Fail-fast config validation | `src/lib/env.ts`, run from `instrumentation.ts` | 16 §2 |
| Refuses `mock` provider in production | `env.ts` | 16 §1 |
| Refuses placeholder secrets and short `AUTH_SECRET` | `env.ts` | 11 §6 |
| Auth rate limiting, per client **and** per account | `auth.ts` + `rate-limit.ts` | 11 §2 |
| Webhook rate limit and 1 MB body cap | webhook route | 11 §8 |
| CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy | `next.config.ts` | 11 §8 |
| Authorization denials audited | `session.ts` | 11 §14 |
| Error boundary with support reference id | `app/error.tsx` | 04 error state |
| Activity log screen (append-only) | `/activity` | 11 §10, BR-38 |
| Settings screen for open decisions + emergency controls | `/settings` | BR-39 |

Per-account rate limiting is deliberate: limiting only by IP lets an attacker
rotate addresses, and limiting only by account lets them lock every user out.

---

## 3. What still blocks production

### 3.1 Business decisions

| GAP | Decision | Consequence while unset |
|---|---|---|
| **GAP-022** | WhatsApp provider | No real messages can be sent. Production refuses to boot on `mock`. |
| GAP-018 | Opt-out words | Nobody can opt out by replying STOP. Set them on `/settings`. |

The other decisions this file used to list — a no-response wait, a reporting
timezone, a send window, a default country — were settings no code read. The
no-response wait is now part of the question step, the analytics screens they
served are gone, and the phone parser hardcodes India, so they are no longer
open questions.

### 3.2 Infrastructure not built

- **No CI pipeline.** Doc 16 §3 step 1 requires reviewed code with passing CI.
  The checks exist (`typecheck`, `test`, `build`, `eslint`) but nothing runs
  them automatically.
- **The tick worker is not scheduled.** `/api/automation/tick` exists and is
  authenticated, but nothing calls it. **Until it is on a schedule, no timer
  fires and no batch enrols past its first slice.** This is the single most
  important operational gap. (The route was also behind the session cookie
  gate until 2026-09-07, which made it unreachable to a scheduler at all; see
  `PROGRESS.md` §11.)
- **No backups configured or restore rehearsed** (doc 16 §6, §7). Supabase has
  automatic backups; a restore has not been tested.
- **No monitoring or alerting** (doc 16 §8, NFR-010). No correlation IDs on
  requests, no metrics, no alert routing.
- **Rate limiting is in-process.** Correct for one instance; multiple instances
  multiply the allowance. Needs Redis before horizontal scaling.

### 3.3 Testing gaps

- **Every test is pure logic.** No test touches the database, so the
  runtime paths — dedupe, status monotonicity, timer claiming, run advancement —
  are unproven by automation. The branch-timeout bug proves this matters: it
  passed every structural test and only surfaced when the app actually ran.
- **QA test cases TC-001…TC-030 are not automated.** Doc 15 §5 makes them the
  mandatory release gate. They are runtime scenarios and need a test database.
- **The permission matrix is not tested per role** (doc 15 §4). Every write
  action has a permission check, verified by reading the code, but only the
  admin role has been exercised at runtime.
- **No accessibility or performance baseline** (NFR-016, NFR-013).

### 3.4 Known performance concerns

- `createBatch` upserts one customer per row in a loop. Fine for the list sizes
  seen so far, slow for tens of thousands. `createMany` plus a single
  `batchMember` insert would fix it if upload time becomes a complaint.
- No load target exists yet (GAP-023).

---

## 4. Shortest path to a safe launch

1. Decide **GAP-022** — until a real provider is configured nothing real can
   be sent, and production refuses to boot on `mock`.
2. Point `/api/automation/tick` at a scheduler (platform cron, every minute).
   Nothing time-based works until this exists.
3. Generate real secrets: `openssl rand -base64 32` for `AUTH_SECRET`,
   `WHATSAPP_VERIFY_TOKEN` and `AUTOMATION_TICK_SECRET`. The config validator
   will refuse to start until these are real.
4. Add CI running `npm run typecheck && npm test && npm run build && npx eslint src prisma`.
5. Automate the doc 15 §5 regression gate against a test database.
6. Rehearse a restore.
7. Work the doc 16 §11 production checklist.

Steps 1–3 are hard blockers. Steps 4–7 are what makes it *safe*, not merely
functional.
