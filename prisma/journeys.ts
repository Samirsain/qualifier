/**
 * The 3% Club introduction journey (DEV-009, BR-08/09/10/44/45).
 *
 * This is a literal encoding of the critical NO rule from doc 17 §10:
 *
 *   first NO → record → stop current information journey →
 *   mark revision/re-engagement → wait exactly 1 day → revision YES/NO;
 *   second NO → record → stop → no repeated immediate same-message sending.
 *
 * Message copy here is placeholder text. Real business-initiated sends must
 * use approved provider templates (BR-51); the send step accepts a templateId
 * for exactly that reason.
 */

export type StepSeed = {
  stepKey: string;
  stepType: "TRIGGER" | "CONDITION" | "ACTION" | "WAIT" | "BRANCH";
  config: Record<string, unknown>;
  nextStepKey?: string | null;
  sortOrder: number;
};

export const THREE_PERCENT_INTRODUCTION: {
  name: string;
  type: "INTRODUCTION";
  description: string;
  entryConditions: Record<string, unknown>;
  steps: StepSeed[];
} = {
  name: "3% Club Introduction",
  type: "INTRODUCTION",
  description:
    "Introduces the club, asks YES/NO, and applies the mandatory NO → 1 day → revision rule.",
  entryConditions: {
    conditions: [{ condition: "customer_is_new" }],
    // GAP-015 — re-entry policy is a pending business decision, so the
    // restrictive default applies until it is approved.
    allowReentry: false,
    reentryCooldownHours: null,
  },
  steps: [
    {
      stepKey: "start",
      stepType: "TRIGGER",
      config: { description: "Customer enters from a campaign, form or manual entry" },
      nextStepKey: "intro",
      sortOrder: 0,
    },
    {
      stepKey: "intro",
      stepType: "ACTION",
      config: {
        action: "send_message",
        body: "Hello! This is the 3% Club. We help a small group of people make better property decisions.",
      },
      nextStepKey: "ask_more",
      sortOrder: 10,
    },

    // ---- The YES / NO decision (BR-09) ----
    {
      stepKey: "ask_more",
      stepType: "BRANCH",
      config: {
        questionKey: "wants_more_info",
        prompt: "Would you like to know more about the 3% Club? Reply YES or NO.",
        answers: { YES: "yes_mark_interested", NO: "no_record" },
        // GAP-017 — free text is not interpreted. Anything unrecognised goes
        // to a human rather than being guessed into a branch.
        otherStepKey: "handoff_unclear",
        // No-response window is GAP-002; the step reads it from settings so
        // the journey does not hard-code an unapproved duration.
        timeout: { settingKey: "automation.no_response_wait_hours" },
        timeoutStepKey: "no_response_followup",
      },
      sortOrder: 20,
    },

    // ---- YES path (BR-08, BR-44) ----
    {
      stepKey: "yes_mark_interested",
      stepType: "ACTION",
      config: { action: "change_customer_status", interestStatus: "INTERESTED" },
      nextStepKey: "yes_benefits",
      sortOrder: 30,
    },
    {
      stepKey: "yes_benefits",
      stepType: "ACTION",
      config: {
        action: "send_message",
        body: "Great. Members get early access to vetted opportunities, direct guidance, and a network that shares real numbers.",
      },
      nextStepKey: "yes_faq",
      sortOrder: 40,
    },
    {
      stepKey: "yes_faq",
      stepType: "ACTION",
      config: {
        action: "send_message",
        body: "Common questions: How does membership work? What does it cost? What do I get first? Ask any of these and we will answer.",
      },
      nextStepKey: "ask_representative",
      sortOrder: 50,
    },
    {
      stepKey: "ask_representative",
      stepType: "BRANCH",
      config: {
        questionKey: "wants_representative",
        prompt: "Would you like one of our representatives to contact you? Reply YES or NO.",
        answers: { YES: "create_call", NO: "yes_no_rep_note" },
        otherStepKey: "handoff_unclear",
      },
      sortOrder: 60,
    },
    {
      stepKey: "create_call",
      stepType: "ACTION",
      config: {
        action: "create_call_request",
        requirement: "Customer asked for a representative to call (3% Club introduction).",
      },
      nextStepKey: "create_followup",
      sortOrder: 70,
    },
    {
      stepKey: "create_followup",
      stepType: "ACTION",
      config: { action: "create_follow_up", type: "Call back", dueInHours: 24 },
      nextStepKey: "yes_done",
      sortOrder: 80,
    },
    {
      stepKey: "yes_no_rep_note",
      stepType: "ACTION",
      config: {
        action: "add_note",
        note: "Customer is interested but declined representative contact for now.",
      },
      nextStepKey: "yes_done",
      sortOrder: 90,
    },
    {
      stepKey: "yes_done",
      stepType: "ACTION",
      config: { action: "add_tag", tag: "3pct-introduced" },
      nextStepKey: null,
      sortOrder: 100,
    },

    // ---- First NO → 1 day → revision (BR-10, BR-45, doc 07 §7) ----
    {
      stepKey: "no_record",
      stepType: "ACTION",
      config: {
        action: "add_note",
        // §7.1 — the first NO is recorded with question, response and the
        // resulting journey action. The CustomerResponse row carries the
        // question and answer; this records the *action taken*.
        note: "First NO recorded on wants_more_info. Information journey stopped; marked for revision.",
      },
      nextStepKey: "no_status",
      sortOrder: 110,
    },
    {
      stepKey: "no_status",
      stepType: "ACTION",
      // §7.2/7.3 — stop pushing information, mark for revision. Revisit Later
      // is the source-defined interest status that means exactly this.
      config: { action: "change_customer_status", interestStatus: "REVISIT_LATER" },
      nextStepKey: "no_tag",
      sortOrder: 120,
    },
    {
      stepKey: "no_tag",
      stepType: "ACTION",
      config: { action: "add_tag", tag: "revision-pending" },
      nextStepKey: "wait_one_day",
      sortOrder: 130,
    },
    {
      stepKey: "wait_one_day",
      stepType: "WAIT",
      // §7.4 — exactly one day. Not "about a day", not configurable away.
      config: { days: 1 },
      nextStepKey: "revision_ask",
      sortOrder: 140,
    },
    {
      stepKey: "revision_ask",
      stepType: "BRANCH",
      config: {
        questionKey: "revision_wants_more_info",
        prompt:
          "Hi again — a day has passed since we last wrote. Would you like to hear about the 3% Club now? Reply YES or NO.",
        answers: { YES: "revision_yes", NO: "second_no_record" },
        otherStepKey: "handoff_unclear",
      },
      sortOrder: 150,
    },
    {
      stepKey: "revision_yes",
      stepType: "ACTION",
      // §7.6 — revision YES returns to the relevant information journey.
      // It re-enters at the benefits step, not at the introduction, so the
      // customer is not sent the same opening message twice.
      config: { action: "remove_tag", tag: "revision-pending" },
      nextStepKey: "yes_mark_interested",
      sortOrder: 160,
    },

    // ---- Second NO (BR-10, doc 07 §7.7/7.8) ----
    {
      stepKey: "second_no_record",
      stepType: "ACTION",
      config: {
        action: "add_note",
        note: "Second NO recorded on revision. Journey stopped. Customer stays in CRM for appropriate future communication.",
      },
      nextStepKey: "second_no_status",
      sortOrder: 170,
    },
    {
      stepKey: "second_no_status",
      stepType: "ACTION",
      config: { action: "change_customer_status", interestStatus: "NOT_INTERESTED" },
      nextStepKey: "second_no_tag",
      sortOrder: 180,
    },
    {
      stepKey: "second_no_tag",
      stepType: "ACTION",
      config: { action: "remove_tag", tag: "revision-pending" },
      nextStepKey: "second_no_stop",
      sortOrder: 190,
    },
    {
      stepKey: "second_no_stop",
      stepType: "ACTION",
      // §7.7 — the journey stops here. There is deliberately no further send
      // step, so the same message cannot be repeated. The customer remains in
      // the CRM (§7.8) — stopping the run does not delete or hide them.
      config: {
        action: "stop_journey",
        reason: "second NO — no further automated messaging on this journey",
      },
      nextStepKey: null,
      sortOrder: 200,
    },

    // ---- No response (BR-14, F-007, doc 07 §8) ----
    {
      stepKey: "no_response_followup",
      stepType: "ACTION",
      config: {
        action: "send_message",
        body: "Just checking in — would you like to know more about the 3% Club? Reply YES or NO whenever you are ready.",
      },
      nextStepKey: "no_response_wait",
      sortOrder: 210,
    },
    {
      stepKey: "no_response_wait",
      stepType: "BRANCH",
      config: {
        questionKey: "no_response_retry",
        prompt: "Reply YES to hear more, or NO if you would rather not.",
        answers: { YES: "yes_mark_interested", NO: "no_record" },
        otherStepKey: "handoff_unclear",
        timeout: { settingKey: "automation.no_response_wait_hours" },
        timeoutStepKey: "no_response_stop",
      },
      sortOrder: 220,
    },
    {
      stepKey: "no_response_stop",
      stepType: "ACTION",
      // §8 — after the configured follow-up, continue *only* according to
      // configured rules. Nothing further is configured, so the journey stops
      // rather than inventing a second, third and fourth chase.
      config: {
        action: "stop_journey",
        reason: "no response after the configured follow-up",
      },
      nextStepKey: null,
      sortOrder: 230,
    },

    // ---- Unrecognised reply → human (GAP-017) ----
    {
      stepKey: "handoff_unclear",
      stepType: "ACTION",
      config: {
        action: "add_note",
        note: "Customer replied with something the journey does not recognise. Handed to staff — free-text interpretation is a pending business decision (GAP-017).",
      },
      nextStepKey: "handoff_stop",
      sortOrder: 240,
    },
    {
      stepKey: "handoff_stop",
      stepType: "ACTION",
      config: {
        action: "stop_journey",
        reason: "handed to staff — reply not recognised",
      },
      nextStepKey: null,
      sortOrder: 250,
    },
  ],
};
