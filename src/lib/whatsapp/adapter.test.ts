import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { whatsapp } from "./adapter";

process.env.WHATSAPP_PROVIDER = "meta";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_APP_SECRET = "app-secret";

const adapter = whatsapp();

test("parses a plain inbound text message", () => {
  const [event] = adapter.parseWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.1",
                  from: "919876543210",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "YES" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(event.kind, "message");
  assert.equal(event.providerMessageId, "wamid.1");
  // Provider omits the leading +; the adapter normalizes to E.164.
  assert.equal(event.from, "+919876543210");
  assert.equal(event.text, "YES");
  assert.equal(event.receivedAt.getTime(), 1700000000 * 1000);
});

test("uses the reply title and id for a tapped button", () => {
  const [event] = adapter.parseWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.2",
                  from: "+919876543210",
                  timestamp: "1700000100",
                  type: "interactive",
                  interactive: { button_reply: { id: "yes_btn", title: "Yes" } },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(event.kind, "message");
  assert.equal(event.text, "Yes");
  assert.equal(event.replyId, "yes_btn");
});

test("parses delivery status events and drops unknown ones", () => {
  const events = adapter.parseWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                { id: "wamid.3", status: "read", timestamp: "1700000200" },
                { id: "wamid.4", status: "deleted", timestamp: "1700000200" },
                {
                  id: "wamid.5",
                  status: "failed",
                  timestamp: "1700000300",
                  errors: [{ code: 131047 }],
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].kind === "status" && events[0].status, "READ");
  assert.equal(events[1].kind === "status" && events[1].failureCode, "131047");
});

test("returns nothing for an unrelated payload", () => {
  assert.deepEqual(adapter.parseWebhook({ object: "whatsapp_business_account" }), []);
  assert.deepEqual(adapter.parseWebhook(null), []);
});

test("subscription handshake only accepts the configured token", () => {
  assert.equal(
    adapter.verifyWebhook({ mode: "subscribe", token: "verify-me" }),
    true,
  );
  assert.equal(adapter.verifyWebhook({ mode: "subscribe", token: "wrong" }), false);
});

test("payload verification requires a matching signature", () => {
  const rawBody = JSON.stringify({ entry: [] });
  const signature =
    "sha256=" + createHmac("sha256", "app-secret").update(rawBody).digest("hex");

  assert.equal(adapter.verifyWebhook({ signature, rawBody }), true);
  assert.equal(
    adapter.verifyWebhook({ signature: "sha256=deadbeef", rawBody }),
    false,
  );
  // Unsigned traffic must never reach business processing.
  assert.equal(adapter.verifyWebhook({ rawBody }), false);
});
