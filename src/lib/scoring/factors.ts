/**
 * The twelve source-defined performance factors (doc 13 §2).
 *
 * This file defines *what is measured*, never *how much it is worth*. Weights,
 * normalisation and caps live in a `staff_score_configs` row that management
 * must approve (GAP-001), so nothing here implies a ranking.
 *
 * `pendingDecision` marks a factor whose raw measure the source has not fully
 * defined. The stand-in measure is stated so it is auditable rather than
 * silently assumed, and the UI shows the caveat next to the number.
 */

export type FactorDirection = "POSITIVE" | "NEGATIVE";

export type FactorSpec = {
  key: FactorKey;
  label: string;
  direction: FactorDirection;
  /** What is actually counted, in plain words. */
  measure: string;
  /** Set when the source leaves the qualifying event undefined. */
  pendingDecision?: string;
};

export const FACTOR_KEYS = [
  "new_leads_handled",
  "customers_contacted",
  "response_activity",
  "follow_ups_completed",
  "follow_ups_on_time",
  "follow_ups_overdue",
  "calls_handled",
  "meetings_handled",
  "qualified_leads",
  "converted_leads",
  "assigned_no_action",
  "customer_outcomes",
] as const;

export type FactorKey = (typeof FACTOR_KEYS)[number];

export const FACTORS: Record<FactorKey, FactorSpec> = {
  new_leads_handled: {
    key: "new_leads_handled",
    label: "New leads handled",
    direction: "POSITIVE",
    measure:
      "Distinct leads assigned to the staff member that moved out of the New stage during the period.",
  },
  customers_contacted: {
    key: "customers_contacted",
    label: "Customers contacted",
    direction: "POSITIVE",
    measure:
      "Distinct assigned customers who received at least one outbound message during the period.",
    pendingDecision:
      "Doc 13 §5 — the qualifying definition of 'contact' is not decided. An outbound message is the auditable stand-in.",
  },
  response_activity: {
    key: "response_activity",
    label: "Response activity",
    direction: "POSITIVE",
    measure:
      "Distinct customers who replied and received a staff reply afterwards during the period.",
    pendingDecision:
      "Doc 13 §2 — the exact qualifying event is TBD. A staff reply following a customer reply is the stand-in.",
  },
  follow_ups_completed: {
    key: "follow_ups_completed",
    label: "Follow-ups completed",
    direction: "POSITIVE",
    measure: "Follow-ups owned by the staff member marked Completed in the period.",
  },
  follow_ups_on_time: {
    key: "follow_ups_on_time",
    label: "Follow-ups completed on time",
    direction: "POSITIVE",
    measure:
      "Completed follow-ups whose completion time was at or before the due time.",
  },
  follow_ups_overdue: {
    key: "follow_ups_overdue",
    label: "Overdue follow-ups",
    direction: "NEGATIVE",
    measure:
      "Follow-ups still Pending at the end of the period whose due time had already passed.",
  },
  calls_handled: {
    key: "calls_handled",
    label: "Calls handled",
    direction: "POSITIVE",
    measure: "Call requests owned by the staff member that reached Completed in the period.",
    pendingDecision:
      "GAP-011 — credit after reassignment is undecided. Credit currently follows the owner at completion time.",
  },
  meetings_handled: {
    key: "meetings_handled",
    label: "Meetings handled",
    direction: "POSITIVE",
    measure: "Meeting requests owned by the staff member that were completed in the period.",
    pendingDecision:
      "GAP-011 — credit after reassignment is undecided. Credit currently follows the owner at completion time.",
  },
  qualified_leads: {
    key: "qualified_leads",
    label: "Qualified leads",
    direction: "POSITIVE",
    measure:
      "Distinct leads owned by the staff member that entered the Qualified stage during the period.",
  },
  converted_leads: {
    key: "converted_leads",
    label: "Converted leads",
    direction: "POSITIVE",
    measure:
      "Distinct leads owned by the staff member that entered the Converted stage during the period.",
    pendingDecision:
      "GAP-009 — the conversion criteria are undecided. Reaching the Converted stage is the stand-in event.",
  },
  assigned_no_action: {
    key: "assigned_no_action",
    label: "Assigned customers with no action",
    direction: "NEGATIVE",
    measure:
      "Assigned customers with no outbound message, completed follow-up, call or meeting during the period.",
  },
  customer_outcomes: {
    key: "customer_outcomes",
    label: "Customer outcomes",
    direction: "POSITIVE",
    measure: "Customers with a recorded outcome value during the period.",
    pendingDecision:
      "GAP-008 — the outcome taxonomy is undefined, so outcomes cannot yet be scored by value. Only presence is counted.",
  },
};

export const FACTOR_LIST: FactorSpec[] = FACTOR_KEYS.map((k) => FACTORS[k]);

/** Raw measured counts for one staff member over one period. */
export type FactorValues = Record<FactorKey, number>;

export function emptyFactorValues(): FactorValues {
  return Object.fromEntries(FACTOR_KEYS.map((k) => [k, 0])) as FactorValues;
}

/** Factors whose raw measure still depends on an open business decision. */
export function pendingFactors(): FactorSpec[] {
  return FACTOR_LIST.filter((f) => f.pendingDecision);
}
