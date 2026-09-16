# Going live on a new WhatsApp account

The app is wired to the Meta Cloud API and talks to it through one adapter, so
nothing here is code — it is account setup plus pasting six values into the
environment.

Start state (cleaned 16 Sep 2026): no credentials, no demo data, no batches.
The database holds one administrator, five starter templates and the starter
funnel.

---

## 1. The six values the app needs

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` — already set |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → API Setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta → WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | System-user token (step 3) |
| `WHATSAPP_APP_SECRET` | Meta → App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose, matched in the webhook panel |

Local values go in `.env`. Production values go in the host's environment
variables — never in a file, never in a chat window. A token pasted anywhere
shared is a token to revoke.

---

## 2. Steps, in this order

### Step 1 — Business portfolio, app, and verification · ~1 day of waiting

**Where:** business.facebook.com → Business settings, then developers.facebook.com

1. Create (or pick) the Business portfolio that owns this WhatsApp account.
2. Create an app of type **Business**, add the **WhatsApp** product to it.
3. Start **Business verification** in Security Centre.

Unverified accounts are capped at a small number of unique recipients per day
and cannot register a display name. Verification is the slow part — start it
first, do the rest while it runs.

### Step 2 — Register the business phone number · ~15 min

**Where:** Meta → WhatsApp → API Setup → Add phone number

Use a real number that is **not** on the consumer WhatsApp or WhatsApp Business
app — Meta will refuse it otherwise. Set the display name, verify by SMS or
call, and then copy:

- **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **WhatsApp Business account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`

The temporary test number that Meta hands out can only message a hand-registered
allow-list; anything else fails with `131030`. Fine for a smoke test, useless for
a real list.

### Step 3 — Permanent access token · ~10 min

**Where:** Business settings → Users → System users

1. Create a system user with the **Admin** role.
2. **Add assets** → your WhatsApp account → full control.
3. **Generate token** → pick the app → scopes `whatsapp_business_messaging` and
   `whatsapp_business_management` → expiry **Never**.

Copy it into `WHATSAPP_ACCESS_TOKEN`. Tokens generated in the API-testing console
expire in about 24 hours — do not use one for production.

### Step 4 — App secret · ~2 min

**Where:** App settings → Basic → App secret → Show

Inbound replies are signed by Meta. Without this secret the app cannot tell a
real reply from a forged one, so it refuses every one of them — no YES and no NO
ever reaches a funnel. Paste it into `WHATSAPP_APP_SECRET`.

### Step 5 — Webhook · ~10 min

**Where:** Meta → WhatsApp → Configuration → Webhook

Meta cannot reach `localhost`. Deployed, the address is permanent; locally, a
tunnel gives you a temporary one (`cloudflared tunnel --url http://localhost:3000`)
that changes on every restart.

1. **Callback URL:** `https://your-domain/api/webhooks/whatsapp`
2. **Verify token:** the exact `WHATSAPP_VERIFY_TOKEN` value.
3. **Verify and save**, then subscribe to the **messages** field. Nothing arrives
   without that subscription.

Meta accepts the URL only if the handshake succeeded, so acceptance is the proof.

### Step 6 — Templates · ~15 min plus Meta's review

**Where:** Meta → WhatsApp Manager → Message templates, then the app → Templates

A business may only open a conversation with a template Meta has approved. Free
text is allowed only within 24 hours of the customer's last message — which, for
a cold list, is never.

Submit your real copy for approval, then fill in, for each template in the app:

| Field in the app | What to put in it |
|---|---|
| Provider template key | The template name exactly as Meta lists it |
| Language | The approved language code, e.g. `en_US` |
| Approval status | `APPROVED` — your own note, so an unapproved one is obvious |

The five seeded templates carry no provider key. Until each one has a key, every
first message fails with a re-engagement error and the tracking screen shows each
number stuck at step 1.

### Step 7 — Start the clock · ~10 min

**Where:** your host's scheduler

Waits, no-reply timeouts and batch enrolment happen only when something calls the
tick endpoint. Nothing calls it by default, so a three-day timer never fires.
Once a minute is enough; more often is harmless.

```bash
curl -X POST https://your-domain/api/automation/tick \
  -H "Authorization: Bearer $AUTOMATION_TICK_SECRET"
```

A JSON body — `{"automations":{"claimed":N,…},"batches":[…]}` — means it worked.
`"pausedAll":true` means the emergency stop is still on.

### Step 8 — Take the brake off · do last

**Where:** the app → Settings → Resume all funnels

That switch is what stands between the funnels and real phones. Everything below
should be true before you press it.

---

## 3. Before the first real send

- **Change the administrator password.** The seeded account is
  `admin@3percent.local` / `ChangeMe123!` unless `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_PASSWORD` were set. Anyone who knows the default can send as you.
- **Generate real secrets.** `AUTH_SECRET`, `AUTOMATION_TICK_SECRET` and
  `WHATSAPP_VERIFY_TOKEN` — `openssl rand -base64 32` each. Production refuses to
  start while any of them is a known placeholder.
- **Set the opt-out words.** Settings → Opt-out words. While it is empty, a
  customer replying STOP is treated as an ordinary reply and keeps receiving
  messages — the fastest way to get a number restricted.
- **Send to ten numbers first.** Watch the batch screen for a day, then scale. The
  funnel version is frozen onto each batch, so a later edit cannot change what is
  already running.

---

## 4. Running one list

1. **Batches → Upload numbers.** Paste or load the list, pick the funnel, review
   what was parsed — rejected rows show the row number and the reason before
   anything is sent.
2. **Start the batch.** Numbers enrol in slices, so a large upload does not go out
   in one burst.
3. **Watch the batch screen.** Each number shows the step it is on, what fires
   next and when; "Show steps" opens its history with timestamps.
4. **Qualified → Export new.** Each export stamps its rows, so the same number is
   never handed to the CRM team twice.
5. **If anything looks wrong:** Settings → Pause all funnels. Every number keeps
   its place and carries on from there.

---

## 5. Reference

### Addresses

| Address | What it is for |
|---|---|
| `/api/webhooks/whatsapp` | Where Meta delivers replies and delivery receipts. Answers the handshake on GET; requires a valid signature on POST. |
| `/api/automation/tick` | Advances every due timer and enrols the next slice of a running batch. Needs the bearer secret. |
| `/api/qualified/export` | The CSV the CRM team receives. `?new=1` returns only rows never exported before. |

### Errors you may see

| Error | What it means |
|---|---|
| `131030` | Recipient is not on a test number's allow-list. Register a real number (step 2). |
| `131047` | More than 24 hours since that person wrote — an approved template is required (step 6). |
| `132000`–`132015` | Template problem: wrong name, wrong language, not approved, or the wrong parameter count. |
| `190` | The access token expired or was revoked (step 3). |
| `403` on the webhook | The signature did not match, or `WHATSAPP_APP_SECRET` is missing (step 4). |

### Checking a credential without sending

```bash
curl "https://graph.facebook.com/v25.0/$WHATSAPP_PHONE_NUMBER_ID" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"
```

A JSON body with the display number means the token and the phone number ID
agree. `190` means the token is wrong; `100` means the ID is.
