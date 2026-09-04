import "server-only";
import { prisma } from "@/lib/prisma";
import { normaliseAnswer } from "@/lib/automation/types";
import { isComputable, type MetricKey } from "@/lib/analytics/definitions";
import { resolvePeriod, type AnalyticsFilters, type Period } from "@/lib/analytics/filters";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The single computation for every KPI (doc 12 §1, §11).
 *
 * Both the dashboard and the analytics page call this. A metric label can
 * therefore never mean two different things in two places, which is the drift
 * §11 asks to prevent.
 *
 * A metric that the source has not defined returns `null`, never a number.
 */

export type MetricValues = Partial<Record<MetricKey, number | null>>;

export type ComputedMetrics = {
  period: Period;
  values: MetricValues;
};

/** Customer-scoped dimension filters, shared by every customer-derived metric. */
function customerWhere(
  filters: AnalyticsFilters,
  scope: Prisma.CustomerWhereInput,
): Prisma.CustomerWhereInput {
  return {
    ...scope,
    ...(filters.sourceId && { sourceId: filters.sourceId }),
    ...(filters.campaignId && { campaignId: filters.campaignId }),
    ...(filters.staffId && { assignedStaffId: filters.staffId }),
    ...(filters.interestStatus && {
      interestStatus: filters.interestStatus as Prisma.CustomerWhereInput["interestStatus"],
    }),
    ...(filters.leadStageCode && {
      lead: { stage: { code: filters.leadStageCode } },
    }),
  };
}

export async function computeMetrics(
  filters: AnalyticsFilters,
  scope: Prisma.CustomerWhereInput = {},
  keys?: MetricKey[],
): Promise<ComputedMetrics> {
  const period = resolvePeriod(filters);
  const within = { gte: period.start, lte: period.end };
  const customers = customerWhere(filters, scope);
  const wanted = (key: MetricKey) =>
    isComputable(key) && (!keys || keys.includes(key));

  const values: MetricValues = {};

  // Metrics the source has not defined stay null, and the UI says why.
  values.active_customers = null;

  const tasks: Promise<void>[] = [];
  const add = <K extends MetricKey>(key: K, run: () => Promise<number>) => {
    if (!wanted(key)) return;
    tasks.push(run().then((v) => void (values[key] = v)));
  };

  // ---- Customer (§3) ----
  add("total_customers", () => prisma.customer.count({ where: customers }));
  add("new_customers", () =>
    prisma.customer.count({ where: { ...customers, createdAt: within } }),
  );

  // ---- Communication (§4) ----
  const messageScope: Prisma.MessageWhereInput = { customer: customers };

  add("messages_sent", () =>
    prisma.message.count({
      where: { ...messageScope, direction: "OUTBOUND", sentAt: within },
    }),
  );
  add("delivered", () =>
    prisma.message.count({
      where: { ...messageScope, direction: "OUTBOUND", deliveredAt: within },
    }),
  );
  add("read", () =>
    prisma.message.count({
      where: { ...messageScope, direction: "OUTBOUND", readAt: within },
    }),
  );
  add("replies", () =>
    prisma.message.count({
      where: { ...messageScope, direction: "INBOUND", createdAt: within },
    }),
  );
  add("failed_communication", () =>
    prisma.message.count({
      where: { ...messageScope, direction: "OUTBOUND", failedAt: within },
    }),
  );

  // YES / NO are counted from structured responses, normalised the same way
  // the automation engine normalises them — one definition, not two.
  const responseScope: Prisma.CustomerResponseWhereInput = {
    customer: customers,
    receivedAt: within,
    ...(filters.automationId && { run: { automationId: filters.automationId } }),
  };

  add("yes_responses", () => countAnswers(responseScope, "YES"));
  add("no_responses", () => countAnswers(responseScope, "NO"));
  add("revision_yes", () =>
    countAnswers({ ...responseScope, questionKey: { contains: "revision" } }, "YES"),
  );
  add("revision_no", () =>
    countAnswers({ ...responseScope, questionKey: { contains: "revision" } }, "NO"),
  );

  add("no_response_customers", () =>
    prisma.automationRun
      .findMany({
        where: {
          customer: customers,
          enteredAt: within,
          events: { some: { eventType: "question.timeout" } },
          ...(filters.automationId && { automationId: filters.automationId }),
        },
        select: { id: true },
      })
      .then((rows) => rows.length),
  );

  // ---- Lead (§5) ----
  add("leads_new", () =>
    prisma.lead.count({ where: { customer: customers, stage: { code: "NEW" } } }),
  );
  add("leads_interested", () =>
    prisma.customer.count({
      where: { ...customers, interestStatus: { in: ["INTERESTED", "VERY_INTERESTED"] } },
    }),
  );
  add("leads_qualified", () =>
    prisma.lead.count({
      where: { customer: customers, stage: { code: "QUALIFIED" } },
    }),
  );
  add("calls", () =>
    prisma.call.count({ where: { customer: customers, requestedAt: within } }),
  );
  add("meetings", () =>
    prisma.meeting.count({ where: { customer: customers, requestedAt: within } }),
  );
  add("converted", () =>
    prisma.leadStageHistory.count({
      where: {
        changedAt: within,
        toStage: { code: "CONVERTED" },
        lead: { customer: customers },
      },
    }),
  );
  add("lost", () =>
    prisma.leadStageHistory.count({
      where: {
        changedAt: within,
        toStage: { code: "LOST" },
        lead: { customer: customers },
      },
    }),
  );

  // ---- Staff (§6) ----
  add("staff_assigned", () =>
    prisma.customer.count({
      where: { ...customers, assignedStaffId: { not: null } },
    }),
  );
  add("staff_contacted", () =>
    prisma.customer.count({
      where: {
        ...customers,
        assignedStaffId: { not: null },
        messages: { some: { direction: "OUTBOUND", createdAt: within } },
      },
    }),
  );
  add("staff_followups", () =>
    prisma.followUp.count({
      where: {
        customer: customers,
        status: "COMPLETED",
        completedAt: within,
        ...(filters.staffId && { assignedStaffId: filters.staffId }),
      },
    }),
  );
  add("staff_overdue", () =>
    prisma.followUp.count({
      where: {
        customer: customers,
        status: "PENDING",
        dueAt: { lt: period.end },
        ...(filters.staffId && { assignedStaffId: filters.staffId }),
      },
    }),
  );

  // ---- Campaign (§7) ----
  add("campaigns_running", () =>
    prisma.campaign.count({
      where: { status: "RUNNING", ...(filters.campaignId && { id: filters.campaignId }) },
    }),
  );
  add("campaign_sent", () =>
    prisma.campaignDelivery.count({
      where: {
        sentAt: within,
        ...(filters.campaignId && { campaignId: filters.campaignId }),
      },
    }),
  );
  add("campaign_replies", () =>
    prisma.campaignDelivery.count({
      where: {
        repliedAt: within,
        ...(filters.campaignId && { campaignId: filters.campaignId }),
      },
    }),
  );

  // ---- Automation (§8) ----
  const runScope: Prisma.AutomationRunWhereInput = {
    customer: customers,
    enteredAt: within,
    ...(filters.automationId && { automationId: filters.automationId }),
  };

  add("automation_entries", () => prisma.automationRun.count({ where: runScope }));
  add("automation_completed", () =>
    prisma.automationRun.count({ where: { ...runScope, state: "COMPLETED" } }),
  );
  add("automation_dropoffs", () =>
    prisma.automationRun.count({
      where: { ...runScope, state: { in: ["STOPPED", "FAILED"] } },
    }),
  );

  await Promise.all(tasks);

  // Response rate is derived, so it is computed after its inputs and states
  // its denominator (§4). A zero denominator yields null, never 0%.
  if (wanted("response_rate")) {
    const sent = values.messages_sent ?? 0;
    const replies = values.replies ?? 0;
    values.response_rate = sent > 0 ? replies / sent : null;
  }

  return { period, values };
}

async function countAnswers(
  where: Prisma.CustomerResponseWhereInput,
  answer: "YES" | "NO",
): Promise<number> {
  // Normalisation is shared with the automation engine rather than reimplemented
  // as a SQL LIKE, so "Y", a button id and plain "yes" all count the same way.
  const rows = await prisma.customerResponse.findMany({
    where,
    select: { response: true },
  });
  return rows.filter((r) => normaliseAnswer(r.response) === answer).length;
}

/**
 * Source performance cohort (doc 12 §9):
 * Customers → Interested → Calls → Meetings → Conversions, by source.
 *
 * Attribution uses the source recorded at customer entry. History is never
 * rewritten retroactively, per §9.
 */
export async function sourcePerformance(
  filters: AnalyticsFilters,
  scope: Prisma.CustomerWhereInput = {},
) {
  const period = resolvePeriod(filters);
  const within = { gte: period.start, lte: period.end };
  const customers = customerWhere(filters, scope);

  const sources = await prisma.source.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return Promise.all(
    sources.map(async (source) => {
      const inSource: Prisma.CustomerWhereInput = { ...customers, sourceId: source.id };

      const [total, interested, calls, meetings, conversions] = await Promise.all([
        prisma.customer.count({ where: inSource }),
        prisma.customer.count({
          where: {
            ...inSource,
            interestStatus: { in: ["INTERESTED", "VERY_INTERESTED"] },
          },
        }),
        prisma.call.count({ where: { customer: inSource, requestedAt: within } }),
        prisma.meeting.count({ where: { customer: inSource, requestedAt: within } }),
        prisma.leadStageHistory.count({
          where: {
            changedAt: within,
            toStage: { code: "CONVERTED" },
            lead: { customer: inSource },
          },
        }),
      ]);

      return { source, total, interested, calls, meetings, conversions };
    }),
  ).then((rows) => rows.filter((r) => r.total > 0));
}

/** Source → responsible staff → outcome drill-through (§9). */
export async function sourceToStaff(
  filters: AnalyticsFilters,
  scope: Prisma.CustomerWhereInput = {},
) {
  const customers = customerWhere(filters, scope);

  const rows = await prisma.customer.groupBy({
    by: ["sourceId", "assignedStaffId"],
    where: { ...customers, assignedStaffId: { not: null } },
    _count: { _all: true },
  });

  const [sources, staff] = await Promise.all([
    prisma.source.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, displayName: true } }),
  ]);

  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));

  return rows
    .map((r) => ({
      source: sourceName.get(r.sourceId) ?? "Unknown",
      staff: staffName.get(r.assignedStaffId ?? "") ?? "Unassigned",
      customers: r._count._all,
    }))
    .sort((a, b) => b.customers - a.customers);
}
