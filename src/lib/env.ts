/**
 * Configuration validation (doc 16 §2: "configuration validation fails fast on
 * missing critical values").
 *
 * Runs once at startup from `instrumentation.ts`. In production a missing or
 * unsafe value stops the process rather than letting the app boot into a state
 * where, for example, sessions can be forged or the webhook is open.
 */

const UNSAFE_SECRETS = [
  "dev-only-change-me",
  "replace-with-openssl-rand-base64-32",
  "dev-verify-token",
  "dev-tick-secret",
  "replace-with-a-random-secret",
  "changeme",
  "secret",
];

export type ConfigProblem = { key: string; message: string };

export function validateConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const isProduction = env.NODE_ENV === "production";

  const require_ = (key: string, message: string) => {
    if (!env[key]?.trim()) problems.push({ key, message });
  };

  const rejectPlaceholder = (key: string) => {
    const value = env[key]?.trim().toLowerCase();
    if (value && UNSAFE_SECRETS.includes(value)) {
      problems.push({
        key,
        message: "is still set to a development placeholder value",
      });
    }
  };

  // --- always required ---
  require_("DATABASE_URL", "is required for every environment");
  require_("AUTH_SECRET", "is required to sign sessions");

  if (!isProduction) return problems;

  // --- production only ---
  rejectPlaceholder("AUTH_SECRET");
  rejectPlaceholder("WHATSAPP_VERIFY_TOKEN");
  rejectPlaceholder("AUTOMATION_TICK_SECRET");

  if ((env.AUTH_SECRET?.length ?? 0) < 32) {
    problems.push({
      key: "AUTH_SECRET",
      message: "must be at least 32 characters in production",
    });
  }

  const provider = env.WHATSAPP_PROVIDER ?? "mock";
  if (provider === "mock") {
    // The mock adapter does not talk to a provider and accepts webhook
    // payloads it cannot cryptographically verify. It must never run in
    // production (doc 16 §1 — mocks belong to development).
    problems.push({
      key: "WHATSAPP_PROVIDER",
      message:
        'is "mock" in production. The mock adapter cannot verify webhook authenticity and sends nothing. Select a real provider.',
    });
  }

  if (provider === "meta") {
    require_("WHATSAPP_ACCESS_TOKEN", "is required by the Meta provider");
    require_("WHATSAPP_PHONE_NUMBER_ID", "is required by the Meta provider");
    require_(
      "WHATSAPP_APP_SECRET",
      "is required to verify webhook signatures — without it inbound webhooks cannot be authenticated",
    );
    require_("WHATSAPP_VERIFY_TOKEN", "is required for the webhook handshake");
  }

  require_(
    "AUTOMATION_TICK_SECRET",
    "is required, otherwise the timer worker endpoint cannot be driven",
  );

  if (env.DATABASE_URL && !/sslmode=|supabase\.|\.rds\.|localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
    problems.push({
      key: "DATABASE_URL",
      message:
        "does not appear to enforce TLS. Doc 11 §5 requires encryption in transit.",
    });
  }

  return problems;
}

/** Throws in production, warns elsewhere. Called once from instrumentation. */
export function assertConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = validateConfig(env);
  if (problems.length === 0) return;

  const report = problems.map((p) => `  - ${p.key} ${p.message}`).join("\n");

  if (env.NODE_ENV === "production") {
    throw new Error(
      `Refusing to start: configuration validation failed.\n${report}\n\n` +
        "See docs 16 §2 and 11 §6. Fix these before deploying.",
    );
  }

  console.warn(`[config] development warnings:\n${report}`);
}
