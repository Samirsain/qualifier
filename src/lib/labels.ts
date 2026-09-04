/** Enum → business wording from README "Canonical Product Vocabulary". */

export const INTEREST_STATUS_LABELS = {
  NOT_YET_CONTACTED: "Not Yet Contacted",
  INTERESTED: "Interested",
  VERY_INTERESTED: "Very Interested",
  NOT_INTERESTED: "Not Interested",
  REVISIT_LATER: "Revisit Later",
  CALL_REQUIRED: "Call Required",
  MEETING_REQUIRED: "Meeting Required",
  CONVERTED: "Converted",
  CLOSED: "Closed",
} as const;

export type InterestStatusKey = keyof typeof INTEREST_STATUS_LABELS;

export const CAMPAIGN_STATUS_LABELS = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  STOPPED: "Stopped",
  ARCHIVED: "Archived",
} as const;

export const AUTOMATION_STATUS_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DISABLED: "Disabled",
} as const;

export const CALL_STATUS_LABELS = {
  NEW: "New",
  ASSIGNED: "Assigned",
  CONTACTED: "Contacted",
  COMPLETED: "Completed",
  RESCHEDULED: "Rescheduled",
  CLOSED: "Closed",
} as const;

/** README "Lead stages" — the source-defined ten-stage pipeline, in order. */
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

/** README "Customer sources". */
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

export function interestTone(status: string): Tone {
  switch (status) {
    case "CONVERTED":
    case "VERY_INTERESTED":
      return "success";
    case "INTERESTED":
      return "info";
    case "CALL_REQUIRED":
    case "MEETING_REQUIRED":
    case "REVISIT_LATER":
      return "warning";
    case "NOT_INTERESTED":
    case "CLOSED":
      return "error";
    default:
      return "neutral";
  }
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
    case "RUNNING":
    case "COMPLETED":
    case "DELIVERED":
    case "READ":
      return "success";
    case "PAUSED":
    case "SCHEDULED":
    case "PENDING":
    case "RESCHEDULED":
      return "warning";
    case "STOPPED":
    case "DISABLED":
    case "FAILED":
      return "error";
    case "SENT":
    case "QUEUED":
    case "NEW":
    case "ASSIGNED":
    case "CONTACTED":
      return "info";
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
