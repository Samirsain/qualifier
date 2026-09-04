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

/**
 * Kept only for prisma/seed.ts, which still seeds the full (untouched)
 * CRM schema. Nothing in the UI reads these any more — schema removal is
 * Task 3, at which point this and the seed data both go.
 */
export const LEAD_STAGES = [
  { code: "NEW", name: "New" },
  { code: "CONTACTED", name: "Contacted" },
  { code: "INTERESTED", name: "Interested" },
  { code: "FOLLOW_UP", name: "Follow-up" },
  { code: "QUALIFIED", name: "Qualified" },
  { code: "CALL_REQUESTED", name: "Call Requested" },
  { code: "MEETING_REQUESTED", name: "Meeting Requested" },
  { code: "NEGOTIATION", name: "Negotiation" },
  { code: "CONVERTED", name: "Converted" },
  { code: "LOST", name: "Lost" },
] as const;

export const CUSTOMER_SOURCES = [
  { code: "WHATSAPP_CAMPAIGN", name: "WhatsApp Campaign", type: "campaign" },
  { code: "THREE_PERCENT_CAMPAIGN", name: "3% Club Campaign", type: "campaign" },
  { code: "WEBSITE", name: "Website", type: "inbound" },
  { code: "FACEBOOK", name: "Facebook", type: "social" },
  { code: "INSTAGRAM", name: "Instagram", type: "social" },
  { code: "REFERRAL", name: "Referral", type: "referral" },
  { code: "AGENT", name: "Agent", type: "partner" },
  { code: "DEALER", name: "Dealer", type: "partner" },
  { code: "EXISTING_CUSTOMER", name: "Existing Customer", type: "internal" },
  { code: "EMPLOYEE", name: "Employee", type: "internal" },
  { code: "MANUAL_ENTRY", name: "Manual Entry", type: "manual" },
  { code: "OTHER", name: "Other", type: "other" },
] as const;

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
