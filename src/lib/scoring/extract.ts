import "server-only";
import { prisma } from "@/lib/prisma";
import { emptyFactorValues, type FactorValues } from "@/lib/scoring/factors";

/**
 * Factor extraction (doc 13 §3 "raw-measure definition").
 *
 * Reads the auditable facts each factor is measured from. Deliberately
 * separate from weighting: these numbers are true regardless of what
 * management later decides a point is worth, and the staff profile shows them
 * whether or not a scoring configuration exists.
 */

export type Period = { start: Date; end: Date };

export function periodFor(
  type: "DAILY" | "WEEKLY" | "MONTHLY" | "OVERALL",
  reference = new Date(),
): Period {
  const end = new Date(reference);
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);

  switch (type) {
    case "DAILY":
      break;
    case "WEEKLY":
      // Monday-start week. Doc 13 §6 says the week boundary is an approved
      // business choice; this is the ISO default until that is decided.
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      break;
    case "MONTHLY":
      start.setDate(1);
      break;
    case "OVERALL":
      // Doc 13 §6 leaves the rolling/lifetime window TBD. Lifetime is the
      // only interpretation that invents nothing.
      start.setTime(0);
      break;
  }

  return { start, end };
}

export async function extractFactors(
  staffId: string,
  period: Period,
): Promise<{ values: FactorValues; assignedCustomers: number }> {
  const values = emptyFactorValues();
  const within = { gte: period.start, lte: period.end };

  const [
    assignedCustomers,
    newLeadsHandled,
    customersContacted,
    responseActivity,
    followUpsCompleted,
    followUpsOnTime,
    followUpsOverdue,
    callsHandled,
    meetingsHandled,
    qualifiedLeads,
    convertedLeads,
    outcomes,
  ] = await Promise.all([
    prisma.customer.count({ where: { assignedStaffId: staffId } }),

    // Leads that left New during the period, credited to their current owner.
    prisma.leadStageHistory.count({
      where: {
        changedAt: within,
        fromStage: { code: "NEW" },
        lead: { assignedStaffId: staffId },
      },
    }),

    prisma.customer.count({
      where: {
        assignedStaffId: staffId,
        messages: { some: { direction: "OUTBOUND", createdAt: within } },
      },
    }),

    // A customer who wrote in and got a reply back in the same period.
    prisma.customer.count({
      where: {
        assignedStaffId: staffId,
        messages: {
          some: { direction: "INBOUND", createdAt: within },
        },
        AND: [
          { messages: { some: { direction: "OUTBOUND", createdAt: within } } },
        ],
      },
    }),

    prisma.followUp.count({
      where: { assignedStaffId: staffId, status: "COMPLETED", completedAt: within },
    }),

    // On time = completed at or before the due moment. Doc 13 counts this
    // separately from "completed", so both are measured.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM follow_ups
      WHERE "assignedStaffId" = ${staffId}::uuid
        AND status = 'COMPLETED'
        AND "completedAt" BETWEEN ${period.start} AND ${period.end}
        AND "completedAt" <= "dueAt"
    `,

    prisma.followUp.count({
      where: {
        assignedStaffId: staffId,
        status: "PENDING",
        dueAt: { lt: period.end },
      },
    }),

    prisma.call.count({
      where: { assignedStaffId: staffId, status: "COMPLETED", completedAt: within },
    }),

    prisma.meeting.count({
      where: { assignedStaffId: staffId, completedAt: within },
    }),

    prisma.leadStageHistory.count({
      where: {
        changedAt: within,
        toStage: { code: "QUALIFIED" },
        lead: { assignedStaffId: staffId },
      },
    }),

    prisma.leadStageHistory.count({
      where: {
        changedAt: within,
        toStage: { code: "CONVERTED" },
        lead: { assignedStaffId: staffId },
      },
    }),

    prisma.customer.count({
      where: {
        assignedStaffId: staffId,
        outcome: { not: null },
        updatedAt: within,
      },
    }),
  ]);

  // Assigned customers with nothing recorded against them in the period.
  const assignedNoAction = await prisma.customer.count({
    where: {
      assignedStaffId: staffId,
      messages: { none: { direction: "OUTBOUND", createdAt: within } },
      followUps: { none: { status: "COMPLETED", completedAt: within } },
      calls: { none: { completedAt: within } },
      meetings: { none: { completedAt: within } },
    },
  });

  values.new_leads_handled = newLeadsHandled;
  values.customers_contacted = customersContacted;
  values.response_activity = responseActivity;
  values.follow_ups_completed = followUpsCompleted;
  values.follow_ups_on_time = Number(followUpsOnTime[0]?.count ?? 0);
  values.follow_ups_overdue = followUpsOverdue;
  values.calls_handled = callsHandled;
  values.meetings_handled = meetingsHandled;
  values.qualified_leads = qualifiedLeads;
  values.converted_leads = convertedLeads;
  values.assigned_no_action = assignedNoAction;
  values.customer_outcomes = outcomes;

  return { values, assignedCustomers };
}

/** The active configuration, or null when management has approved none. */
export async function activeScoreConfig() {
  return prisma.staffScoreConfig.findFirst({
    where: {
      active: true,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}
