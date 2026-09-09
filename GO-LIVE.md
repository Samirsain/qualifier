# Going live: what only you can do

The software is wired to the Meta Cloud API, and every part that can be tested
without a live recipient has been tested. What is left is account configuration
and two decisions — none of it is code.

Checked against the running app on 8 September 2026.

- ✅ Sending pipeline verified
- ⏳ 6 manual steps left
- ⛔ Sending paused (deliberately)

---

## 1. Where it stands

These are not assumptions. Each row was run against the real Meta API or the
running app, and the exact response is recorded.

| Checked | Result | Evidence |
|---|---|---|
| Access token and phone number | Working — "Test Number", quality **GREEN**, Cloud API | `GET /v25.0/1271206122750479` returned `+1 555-673-3609` |
| Approved templates | 5 approved, including `hello_world` | `GET /{waba-id}/message_templates` |
| Outbound send path | Request accepted and understood by Meta; only the recipient was refused | `(#131030) Recipient phone number not in allowed list` — for both free text and an approved template |
| Failure recording | Correct — nothing is reported as sent when it was not | Message rows written as `FAILED` / `131030`, no provider id |
| Webhook handshake | Working, and closed by default | correct verify token → `200` + challenge · wrong token → `403` · unsigned POST → `403` |
| Funnel engine | Runs a number through the funnel, times out a silent one, records the outcome | ask → 3-day timer armed → timeout → status `NO_RESPONSE`, run stopped |

> **The one thing to know first.** The access token currently in `.env` came from
> the API-testing console. Those tokens expire in about 24 hours, and this one was
> pasted into a chat window, so treat it as public. Step 6 replaces it with a
> permanent one — until then, sending will simply stop working tomorrow.

---

## 2. Six steps, in this order

Steps 1–4 get one real message out and one real reply back. Steps 5–6 turn that
from a demo into something that runs on its own.

### Step 1 — Add your own number as a test recipient · ~5 min

**Where:** Meta dashboard → WhatsApp → API Setup → "To" → Manage phone number list

A test number may only message numbers you have registered. Add your own WhatsApp
number, enter the verification code Meta sends, and it appears in the list. This
is the single reason nothing has been delivered yet.

**How you know it worked:** ask for the send check to be re-run. The result flips
from `131030` to `ok: true` with a provider message id, and the message arrives on
your phone within a few seconds.

### Step 2 — Copy the App Secret into the app · ~2 min

**Where:** Meta dashboard → App settings → Basic → App secret → Show

Inbound replies are signed by Meta. Without this secret the app cannot tell a real
reply from a forged one, so it refuses every one of them — which is why an unsigned
POST is already answered with `403`. No secret, no YES and no NO ever reaches a
funnel.

```
WHATSAPP_APP_SECRET="paste-the-app-secret-here"
```

Add it to `.env` in the project root, then restart the dev server so the new value
is read.

**How you know it worked:** after step 3, a reply sent from your phone appears
against that number in the app — "last activity" moves to "just now" and the funnel
advances a step.

### Step 3 — Give Meta a public address for this app · ~10 min

**Where:** your machine, then Meta dashboard → WhatsApp → Configuration → Webhook

Meta cannot reach `localhost`. A tunnel gives your running app a temporary public
HTTPS address; a deployment gives it a permanent one. Either works — the tunnel is
faster to try.

```
cloudflared tunnel --url http://localhost:3000
```

Then, in the Webhook panel:

1. **Callback URL:** `https://your-tunnel-address/api/webhooks/whatsapp`
2. **Verify token:** `dev-verify-token` — the value currently in `.env`; change both
   together for production.
3. Press **Verify and save**, then subscribe to the **messages** field. Nothing
   arrives without that subscription.

**How you know it worked:** Meta accepts the callback URL immediately — it only
does that if the handshake succeeded. The tunnel address changes each time you
restart it, and Meta must be updated when it does.

### Step 4 — Point each funnel step at an approved template · ~15 min

**Where:** the app → Templates

A business may only open a conversation with a template Meta has approved. Free
text is allowed only inside the 24 hours after the customer last wrote to you —
which, for a cold list, is never. Each template in the app therefore needs the name
of its Meta counterpart.

| Field in the app | What to put in it |
|---|---|
| Provider template key | The template name as Meta lists it, e.g. `hello_world` |
| Language | The approved language code, e.g. `en_US` |
| Approval status | `APPROVED` — your own note, so an unapproved one is obvious |

Your five demo templates ("Starter — introduction", and so on) carry no provider
key yet. Real copy has to be submitted to Meta for approval before it can be used;
`hello_world` is fine for testing the plumbing.

> **If you skip this:** every first message fails with a re-engagement error and the
> batch produces nothing, while the tracking screen honestly shows each number stuck
> at step 1.

### Step 5 — Start the clock · ~10 min

**Where:** your server, or your hosting platform's scheduler

Waits, no-reply timeouts and batch enrolment all happen when something calls the
app's tick endpoint. Nothing calls it today, so nothing time-based happens at all —
a three-day timer simply never fires. Once a minute is enough; calling it more
often is harmless.

```
curl -X POST http://localhost:3000/api/automation/tick \
  -H "Authorization: Bearer $AUTOMATION_TICK_SECRET"
```

On a host, use its own scheduler (Vercel Cron, a GitHub Actions schedule, or a
systemd timer) pointed at the same URL with the same header.

**How you know it worked:** the response is JSON —
`{"automations":{"claimed":N,…},"batches":[…]}`. `"pausedAll":true` means the
emergency stop is still on; see step 6.

### Step 6 — Swap the token, then take the brake off · do last

**Where:** Meta → Business settings → Users → System users, then the app → Settings

Create a system user, give it access to the WhatsApp account, and generate a
permanent access token with `whatsapp_business_messaging` and
`whatsapp_business_management`. Put that in `.env` as `WHATSAPP_ACCESS_TOKEN` and
delete the temporary one — including from `wtsapp.md`, which currently holds it in
plain text.

Only then open **Settings → Resume all funnels**. That single switch is what stands
between the funnels and real phones.

> **Before you press it:** the database still holds 102 demo numbers in three
> batches. They are invented numbers in the `+9199…` range, so every send would
> fail — a burst of failures against your account for no reason. Clear the demo data
> first.

---

## 3. The short safety list

- **Change the administrator password.** The account is `admin@3percent.local` with
  the seeded password `ChangeMe123!`. Anyone who knows the default can send messages
  as you.
- **Generate real secrets.** `AUTH_SECRET`, `AUTOMATION_TICK_SECRET` and
  `WHATSAPP_VERIFY_TOKEN` are development placeholders. `openssl rand -base64 32`
  gives you each one. Production refuses to start while they are placeholders.
- **Decide the opt-out words.** Settings → Opt-out words. While it is empty, a
  customer replying STOP is treated as an ordinary reply and keeps receiving
  messages — the fastest way to get a WhatsApp number restricted.
- **Clear the demo data.** Three demo batches and 102 invented numbers. Ask and it
  can be removed in one command.
- **Send to a small real list first.** Ten numbers, watch the batch screen for a
  day, then scale. The funnel version is frozen onto each batch, so a later edit
  cannot change what is already running.

---

## 4. Running one list, once everything is on

1. **Batches → Upload numbers.** Paste or load the list, pick the funnel, and review
   what was parsed — rejected rows are shown with the row number and the reason
   before anything is sent.
2. **Start the batch.** Numbers enrol in slices, so a large upload does not go out in
   one burst.
3. **Watch the batch screen.** Each number shows the step it is on, what fires next
   and when, and "Show steps" opens its full history with timestamps.
4. **Qualified → Export new.** Hand the CSV to the CRM team. Each export stamps its
   rows, so the same number is never handed over twice.
5. **If anything looks wrong:** Settings → Pause all funnels. Every number keeps its
   place and carries on from there when you resume.

---

## 5. Reference

### Settings in `.env`

| Setting | State | Where it comes from |
|---|---|---|
| `WHATSAPP_PROVIDER` | ✅ `meta` | Set — the mock provider is off |
| `WHATSAPP_ACCESS_TOKEN` | ⏳ temporary | Expires in ~24h; replace with a system-user token (step 6) |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ set | `1271206122750479` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ✅ set | `1472620244923040` |
| `WHATSAPP_APP_SECRET` | ⛔ empty | App settings → Basic (step 2) |
| `WHATSAPP_VERIFY_TOKEN` | ⏳ placeholder | Any string, matched in the Meta webhook panel |
| `AUTOMATION_TICK_SECRET` | ⏳ placeholder | Guards the tick endpoint (step 5) |

### Addresses

| Address | What it is for |
|---|---|
| `/api/webhooks/whatsapp` | Where Meta delivers replies and delivery receipts. Answers the handshake on GET; requires a valid signature on POST. |
| `/api/automation/tick` | Advances every due timer and enrols the next slice of a running batch. Needs the bearer secret. |
| `/api/qualified/export` | The CSV the CRM team receives. `?new=1` returns only rows never exported before. |

### Errors you may see

| Error | What it means |
|---|---|
| `131030` | The recipient is not on the test number's allowed list. Step 1. |
| `131047` | More than 24 hours since that person last wrote — an approved template is required. Step 4. |
| `190` | The access token expired or was revoked. Step 6. |
| `403` on the webhook | The signature did not match, or the App Secret is missing. Step 2. |

---

Every claim here was checked against the running application and the live Meta API;
anything not yet done is listed as not done.
