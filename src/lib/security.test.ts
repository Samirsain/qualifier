import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateConfig } from "./env";
import { rateLimit, resetLimit, clientKey } from "./rate-limit";

const PROD_OK: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres",
  AUTH_SECRET: "a".repeat(48),
  WHATSAPP_PROVIDER: "meta",
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_VERIFY_TOKEN: "a-real-verify-token",
  AUTOMATION_TICK_SECRET: "a-real-tick-secret",
};

const keysOf = (env: NodeJS.ProcessEnv) => validateConfig(env).map((p) => p.key);

// ---- Configuration validation (doc 16 §2) ----

test("a correctly configured production environment passes", () => {
  assert.deepEqual(validateConfig(PROD_OK), []);
});

test("production refuses the mock WhatsApp provider", () => {
  const problems = validateConfig({ ...PROD_OK, WHATSAPP_PROVIDER: "mock" });
  assert.ok(problems.some((p) => p.key === "WHATSAPP_PROVIDER"));
  assert.match(problems.find((p) => p.key === "WHATSAPP_PROVIDER")!.message, /mock/);
});

test("production refuses a default provider (mock is the default)", () => {
  const env = { ...PROD_OK };
  delete env.WHATSAPP_PROVIDER;
  assert.ok(keysOf(env).includes("WHATSAPP_PROVIDER"));
});

test("production refuses development placeholder secrets", () => {
  assert.ok(
    keysOf({ ...PROD_OK, AUTH_SECRET: "dev-only-change-me" }).includes("AUTH_SECRET"),
  );
  assert.ok(
    keysOf({ ...PROD_OK, WHATSAPP_VERIFY_TOKEN: "dev-verify-token" }).includes(
      "WHATSAPP_VERIFY_TOKEN",
    ),
  );
  assert.ok(
    keysOf({ ...PROD_OK, AUTOMATION_TICK_SECRET: "dev-tick-secret" }).includes(
      "AUTOMATION_TICK_SECRET",
    ),
  );
});

test("production insists the database connection is encrypted or private", () => {
  // A public host with no sslmode is the case the check exists for.
  assert.ok(
    keysOf({ ...PROD_OK, DATABASE_URL: "postgresql://u:p@db.example.com:5432/app" }).includes(
      "DATABASE_URL",
    ),
  );
  // A platform's internal network never leaves the platform, like loopback.
  assert.deepEqual(
    keysOf({
      ...PROD_OK,
      DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
    }),
    [],
  );
});

test("production refuses a short session secret", () => {
  assert.ok(keysOf({ ...PROD_OK, AUTH_SECRET: "short" }).includes("AUTH_SECRET"));
});

test("the Meta provider cannot run without a webhook signing secret", () => {
  const env = { ...PROD_OK };
  delete env.WHATSAPP_APP_SECRET;
  const problem = validateConfig(env).find((p) => p.key === "WHATSAPP_APP_SECRET");
  assert.ok(problem, "an unsigned webhook must block startup");
  assert.match(problem!.message, /authenticated/);
});

test("development only requires the essentials", () => {
  const problems = validateConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://localhost:5432/dev",
    AUTH_SECRET: "dev-only-change-me",
    WHATSAPP_PROVIDER: "mock",
  });
  // Placeholders and the mock provider are fine locally; missing basics are not.
  assert.deepEqual(problems, []);
  assert.ok(
    keysOf({ NODE_ENV: "development" }).includes("DATABASE_URL"),
  );
});

// ---- The webhook is not open, even with the mock provider ----

test("the mock adapter rejects an unsigned webhook payload", async () => {
  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.WHATSAPP_VERIFY_TOKEN = "shared-secret";
  const { whatsapp } = await import("./whatsapp/adapter");
  const adapter = whatsapp();

  const rawBody = JSON.stringify({ entry: [] });

  // This is the case that used to return true and let anyone inject messages.
  assert.equal(adapter.verifyWebhook({ rawBody }), false);
  assert.equal(adapter.verifyWebhook({ signature: "sha256=bad", rawBody }), false);

  const good =
    "sha256=" + createHmac("sha256", "shared-secret").update(rawBody).digest("hex");
  assert.equal(adapter.verifyWebhook({ signature: good, rawBody }), true);
});

test("the mock adapter rejects the handshake without the token", async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = "shared-secret";
  const { whatsapp } = await import("./whatsapp/adapter");
  const adapter = whatsapp();
  assert.equal(adapter.verifyWebhook({ mode: "subscribe", token: "wrong" }), false);
  assert.equal(
    adapter.verifyWebhook({ mode: "subscribe", token: "shared-secret" }),
    true,
  );
});

// ---- Rate limiting (doc 11 §2, §8) ----

test("a bucket allows the limit then refuses", () => {
  const key = `test:${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimit(key, 3, 60).allowed, true, `attempt ${i + 1}`);
  }
  const blocked = rateLimit(key, 3, 60);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("buckets are independent, so one client cannot lock out another", () => {
  const a = `test:a:${Math.random()}`;
  const b = `test:b:${Math.random()}`;
  for (let i = 0; i < 5; i++) rateLimit(a, 2, 60);
  assert.equal(rateLimit(a, 2, 60).allowed, false);
  assert.equal(rateLimit(b, 2, 60).allowed, true);
});

test("a successful sign-in clears the counter", () => {
  const key = `test:${Math.random()}`;
  rateLimit(key, 2, 60);
  rateLimit(key, 2, 60);
  assert.equal(rateLimit(key, 2, 60).allowed, false);
  resetLimit(key);
  assert.equal(rateLimit(key, 2, 60).allowed, true);
});

test("client identity prefers the first forwarded hop", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  assert.equal(clientKey(headers, "auth"), "auth:203.0.113.9");
  // No headers at all falls back to a shared bucket — stricter, not looser.
  assert.equal(clientKey(new Headers(), "auth"), "auth:unknown");
});
