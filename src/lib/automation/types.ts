import { z } from "zod";

/**
 * Automation step configuration (doc 07 §5).
 *
 * The action and condition vocabularies cover what a qualification funnel can
 * actually do: message, branch on the answer, set a status, and qualify.
 */

/** Supported actions. */
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

export type ActionConfig = z.infer<typeof actionConfig>;

/**
 * WAIT — a durable timer.
 *
 * `days` covers "wait exactly 1 day" (doc 07 §7). `settingKey` reads the
 * duration from `system_settings` so an undecided business value (GAP-002)
 * is configuration, not a constant baked into a journey.
 */
export const waitConfig = z
  .object({
    days: z.number().min(0).max(365).optional(),
    hours: z.number().min(0).max(24 * 365).optional(),
    settingKey: z.string().max(120).optional(),
  })
  .refine(
    (v) => v.days !== undefined || v.hours !== undefined || v.settingKey !== undefined,
    { message: "A wait needs days, hours or a settingKey" },
  );

export type WaitConfig = z.infer<typeof waitConfig>;

/**
 * BRANCH — ask a question and wait for the customer's answer.
 *
 * `answers` maps a normalised answer to the next step key. `otherStepKey`
 * handles anything unrecognised; because free-text interpretation is GAP-017,
 * an unmapped reply routes to a human rather than being guessed at.
 */
export const branchConfig = z.object({
  questionKey: z.string().min(1).max(60),
  prompt: z.string().min(1).max(4000),
  templateId: z.uuid().optional(),
  answers: z.record(z.string(), z.string()),
  otherStepKey: z.string().max(60).optional(),
  /** No answer within this window routes to `timeoutStepKey` (doc 07 §8). */
  timeout: waitConfig.optional(),
  timeoutStepKey: z.string().max(60).optional(),
});

export type BranchConfig = z.infer<typeof branchConfig>;

/** Supported conditions — only the ones that still have data behind them. */
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

export type ConditionConfig = z.infer<typeof conditionConfig>;

export const triggerConfig = z.object({
  /** Documentation only — entry is evaluated from the automation's
   *  `entryConditions`, not from the trigger step. */
  description: z.string().max(200).optional(),
});

/** Entry conditions on the automation itself (doc 07 §6). */
export const entryConditions = z.object({
  conditions: z.array(conditionConfig).default([]),
  /**
   * GAP-015 — re-entry frequency, cooldown and simultaneous-run policy are an
   * open business decision. Default is the restrictive reading: one active run
   * per customer per automation, and no re-entry after completion until the
   * business approves one.
   */
  allowReentry: z.boolean().default(false),
  reentryCooldownHours: z.number().int().min(0).max(24 * 365).nullable().default(null),
});

export type EntryConditions = z.infer<typeof entryConditions>;

/** Normalise a customer reply to a branch answer key. */
export function normaliseAnswer(text: string, replyId?: string | null): string {
  const raw = (replyId ?? text ?? "").trim().toUpperCase();
  if (!raw) return "";
  // Structured button ids win; plain YES/NO text is the documented fallback.
  if (raw === "YES" || raw === "Y" || raw.endsWith("_YES")) return "YES";
  if (raw === "NO" || raw === "N" || raw.endsWith("_NO")) return "NO";
  return raw;
}
