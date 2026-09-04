/**
 * Central KPI definitions (doc 12 §1, §11).
 *
 * "Every metric states population, numerator, denominator, time field and
 * filters." That is a documentation requirement *and* an anti-drift measure:
 * the dashboard and the analytics page read metric values from one computation
 * keyed by these definitions, so the same label can never mean two things.
 *
 * A metric with `pendingDecision` is **not computed**. It appears in the UI
 * with its reason, because a KPI the business has not defined cannot be given
 * a number without inventing the definition.
 */

export type MetricGroup =
  | "customer"
  | "communication"
  | "lead"
  | "staff"
  | "campaign"
  | "automation";

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  group: MetricGroup;
  /** Which records are in scope. */
  population: string;
  /** What is counted. */
  numerator: string;
  /** Present only for rates. */
  denominator?: string;
  /** Which timestamp the period filter applies to. */
  timeField: string;
  /** Set when the source has not defined the metric; it is not computed. */
  pendingDecision?: string;
};

export const METRIC_KEYS = [
  // Customer (doc 12 §3)
  "total_customers",
  "new_customers",
  "active_customers",
  // Communication (§4)
  "messages_sent",
  "delivered",
  "read",
  "replies",
  "failed_communication",
  "yes_responses",
  "no_responses",
  "revision_yes",
  "revision_no",
  "no_response_customers",
  "response_rate",
  // Lead (§5)
  "leads_new",
  "leads_interested",
  "leads_qualified",
  "calls",
  "meetings",
  "converted",
  "lost",
  // Staff (§6)
  "staff_assigned",
  "staff_contacted",
  "staff_followups",
  "staff_overdue",
  // Campaign (§7)
  "campaigns_running",
  "campaign_sent",
  "campaign_replies",
  // Automation (§8)
  "automation_entries",
  "automation_completed",
  "automation_dropoffs",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRICS: Record<MetricKey, MetricDefinition> = {
  // ---- Customer (§3) ----
  total_customers: {
    key: "total_customers",
    label: "Total Customers",
    group: "customer",
    population: "Customer records visible to the viewer, after dimension filters.",
    numerator: "Distinct customers.",
    timeField: "As-of the end of the period, not an event count.",
  },
  new_customers: {
    key: "new_customers",
    label: "New Customers",
    group: "customer",
    population: "Customers created within the period.",
    numerator: "Distinct customers.",
    timeField: "customers.created_at",
  },
  active_customers: {
    key: "active_customers",
    label: "Active Customers",
    group: "customer",
    population: "Undefined.",
    numerator: "Undefined.",
    timeField: "Undefined.",
    pendingDecision:
      "GAP-012 — the source names this KPI but defines neither what counts as active nor over what window. Not computed.",
  },

  // ---- Communication (§4) ----
  messages_sent: {
    key: "messages_sent",
    label: "Messages Sent",
    group: "communication",
    population: "Outbound messages accepted by the provider.",
    numerator:
      "Messages whose delivery status reached Sent or later. Messages that failed before send are excluded.",
    timeField: "messages.sent_at",
  },
  delivered: {
    key: "delivered",
    label: "Delivered",
    group: "communication",
    population: "Outbound messages.",
    numerator: "Distinct messages with a delivered-or-later status.",
    timeField: "messages.delivered_at",
  },
  read: {
    key: "read",
    label: "Read",
    group: "communication",
    population: "Outbound messages.",
    numerator: "Distinct messages with a read status.",
    timeField: "messages.read_at",
  },
  replies: {
    key: "replies",
    label: "Replies",
    group: "communication",
    population: "Inbound customer messages.",
    numerator: "Distinct inbound messages.",
    timeField: "messages.created_at",
  },
  failed_communication: {
    key: "failed_communication",
    label: "Failed Communication",
    group: "communication",
    population: "Outbound messages.",
    numerator: "Messages in a final failed state.",
    timeField: "messages.failed_at",
  },
  yes_responses: {
    key: "yes_responses",
    label: "YES",
    group: "communication",
    population: "Structured customer responses inside an automation question.",
    numerator: "Responses normalising to YES.",
    timeField: "customer_responses.received_at",
  },
  no_responses: {
    key: "no_responses",
    label: "NO",
    group: "communication",
    population: "Structured customer responses inside an automation question.",
    numerator: "Responses normalising to NO.",
    timeField: "customer_responses.received_at",
  },
  revision_yes: {
    key: "revision_yes",
    label: "Revision YES",
    group: "communication",
    population: "Responses to the 1-day revision question only.",
    numerator: "Responses normalising to YES.",
    timeField: "customer_responses.received_at",
  },
  revision_no: {
    key: "revision_no",
    label: "Revision NO",
    group: "communication",
    population: "Responses to the 1-day revision question only.",
    numerator: "Responses normalising to NO.",
    timeField: "customer_responses.received_at",
  },
  no_response_customers: {
    key: "no_response_customers",
    label: "No-response Customers",
    group: "communication",
    population: "Automation runs that reached a no-response branch.",
    numerator: "Distinct runs whose recorded events include a question timeout.",
    timeField: "automation_events.occurred_at",
  },
  response_rate: {
    key: "response_rate",
    label: "Response Rate",
    group: "communication",
    population: "Outbound messages sent in the period.",
    numerator: "Inbound customer messages in the period.",
    denominator: "Messages Sent in the period.",
    timeField: "messages.sent_at for the denominator, messages.created_at for the numerator",
  },

  // ---- Lead (§5) ----
  leads_new: {
    key: "leads_new",
    label: "New",
    group: "lead",
    population: "Leads.",
    numerator: "Leads currently in the New stage.",
    timeField: "Current state, not a transition count.",
  },
  leads_interested: {
    key: "leads_interested",
    label: "Interested",
    group: "lead",
    population: "Customers.",
    numerator: "Customers currently at Interested or Very Interested.",
    timeField: "Current state.",
  },
  leads_qualified: {
    key: "leads_qualified",
    label: "Qualified",
    group: "lead",
    population: "Leads.",
    numerator: "Leads currently in the Qualified stage.",
    timeField: "Current state.",
  },
  calls: {
    key: "calls",
    label: "Calls",
    group: "lead",
    population: "Call request records — not messages that mention a call.",
    numerator: "Distinct call requests raised in the period.",
    timeField: "calls.requested_at",
  },
  meetings: {
    key: "meetings",
    label: "Meetings",
    group: "lead",
    population: "Meeting request records.",
    numerator: "Distinct meeting requests raised in the period.",
    timeField: "meetings.requested_at",
  },
  converted: {
    key: "converted",
    label: "Converted",
    group: "lead",
    population: "Leads that entered the Converted stage.",
    numerator: "Distinct leads with a stage transition into Converted.",
    timeField: "lead_stage_history.changed_at",
    pendingDecision:
      "GAP-009 — reaching the Converted stage is the stand-in event. The business has not defined the conversion criteria, so this counts the stage, not an approved definition.",
  },
  lost: {
    key: "lost",
    label: "Lost",
    group: "lead",
    population: "Leads that entered the Lost stage.",
    numerator: "Distinct leads with a stage transition into Lost.",
    timeField: "lead_stage_history.changed_at",
  },

  // ---- Staff (§6) ----
  staff_assigned: {
    key: "staff_assigned",
    label: "Assigned",
    group: "staff",
    population: "Customers with an owner.",
    numerator: "Distinct customers assigned to the filtered staff.",
    timeField: "Current ownership.",
  },
  staff_contacted: {
    key: "staff_contacted",
    label: "Contacted",
    group: "staff",
    population: "Assigned customers.",
    numerator: "Distinct assigned customers with an outbound message in the period.",
    timeField: "messages.created_at",
    pendingDecision:
      "Doc 12 §6 — the qualifying contact event is undefined. An outbound message is the auditable stand-in.",
  },
  staff_followups: {
    key: "staff_followups",
    label: "Follow-ups completed",
    group: "staff",
    population: "Follow-ups.",
    numerator: "Follow-ups completed in the period.",
    timeField: "follow_ups.completed_at",
  },
  staff_overdue: {
    key: "staff_overdue",
    label: "Overdue",
    group: "staff",
    population: "Follow-ups.",
    numerator: "Follow-ups still pending whose due time is before the period end.",
    timeField: "follow_ups.due_at, measured against the period end",
  },

  // ---- Campaign (§7) ----
  campaigns_running: {
    key: "campaigns_running",
    label: "Running campaigns",
    group: "campaign",
    population: "Campaigns.",
    numerator: "Campaigns currently in the Running state.",
    timeField: "Current state.",
  },
  campaign_sent: {
    key: "campaign_sent",
    label: "Campaign sends",
    group: "campaign",
    population: "Campaign deliveries.",
    numerator: "Deliveries that reached Sent or later.",
    timeField: "campaign_deliveries.sent_at",
  },
  campaign_replies: {
    key: "campaign_replies",
    label: "Campaign replies",
    group: "campaign",
    population: "Campaign deliveries.",
    numerator: "Deliveries with a recorded reply.",
    timeField: "campaign_deliveries.replied_at",
    pendingDecision:
      "GAP-010 — no attribution window is applied. A reply is counted against the delivery regardless of how long after the send it arrived.",
  },

  // ---- Automation (§8) ----
  automation_entries: {
    key: "automation_entries",
    label: "Entries",
    group: "automation",
    population: "Automation runs.",
    numerator: "Runs entered in the period.",
    timeField: "automation_runs.entered_at",
  },
  automation_completed: {
    key: "automation_completed",
    label: "Completed",
    group: "automation",
    population: "Automation runs entered in the period.",
    numerator: "Runs that reached Completed.",
    timeField: "automation_runs.entered_at",
  },
  automation_dropoffs: {
    key: "automation_dropoffs",
    label: "Drop-offs",
    group: "automation",
    population: "Automation runs entered in the period.",
    numerator:
      "Runs that stopped or failed before completion, classified by stop reason.",
    timeField: "automation_runs.entered_at",
  },
};

export const METRIC_LIST: MetricDefinition[] = METRIC_KEYS.map((k) => METRICS[k]);

export function metricsInGroup(group: MetricGroup): MetricDefinition[] {
  return METRIC_LIST.filter((m) => m.group === group);
}

/** Metrics the source has not defined well enough to compute. */
export function undefinedMetrics(): MetricDefinition[] {
  return METRIC_LIST.filter((m) => m.pendingDecision && !isComputable(m.key));
}

/**
 * A metric with a caveat is still computed when the caveat is about *meaning*
 * (a stand-in event) rather than *absence* (no definition at all).
 */
const NOT_COMPUTABLE: MetricKey[] = ["active_customers"];

export function isComputable(key: MetricKey): boolean {
  return !NOT_COMPUTABLE.includes(key);
}
