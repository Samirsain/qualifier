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
      noReplyDays: 3,
      noReplyKey: "end_no_reply",
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
      noReplyDays: 3,
      noReplyKey: "end_no_reply",
    },
    { kind: "qualify", key: "qualified" },
    {
      kind: "stop",
      key: "end_qualified",
      reason: "qualified for the CRM team",
      status: null,
    },
    { kind: "message", key: "declined", templateId: "" },
    {
      kind: "stop",
      key: "end_declined",
      reason: "not interested",
      status: "NOT_INTERESTED",
    },
    {
      kind: "stop",
      key: "end_no_reply",
      reason: "no reply within three days",
      status: "NO_RESPONSE",
    },
  ],
};
