import { z } from "zod";

/**
 * Global analytics dimensions and filters (doc 12 §2).
 *
 * Pure: a filter set in, plain date bounds and id lists out. Both the
 * dashboard and the analytics page build their queries from the same parsed
 * object, which is what §1 requires — "dashboards and reports must apply
 * identical KPI definitions".
 *
 * GAP-020 — the reporting timezone is undecided. Every boundary here is
 * computed in the server's local zone and the UI says so, rather than
 * silently picking one and making the numbers unexplainable later.
 */

export const analyticsFilters = z.object({
  /** Named range, or CUSTOM with explicit bounds. */
  range: z
    .enum(["TODAY", "LAST_7", "LAST_30", "THIS_MONTH", "LAST_MONTH", "ALL", "CUSTOM"])
    .default("LAST_30"),
  from: z.coerce.date().nullable().default(null),
  to: z.coerce.date().nullable().default(null),
  sourceId: z.union([z.uuid(), z.literal("")]).default(""),
  campaignId: z.union([z.uuid(), z.literal("")]).default(""),
  staffId: z.union([z.uuid(), z.literal("")]).default(""),
  automationId: z.union([z.uuid(), z.literal("")]).default(""),
  leadStageCode: z.string().max(60).default(""),
  interestStatus: z.string().max(60).default(""),
});

export type AnalyticsFilters = z.infer<typeof analyticsFilters>;

export type Period = { start: Date; end: Date; label: string };

/**
 * Resolve a filter set to an explicit period.
 *
 * `ALL` starts at epoch rather than at some invented lookback, because the
 * source does not define a default reporting window.
 */
export function resolvePeriod(
  filters: AnalyticsFilters,
  now = new Date(),
): Period {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (filters.range) {
    case "TODAY":
      return { start, end, label: "Today" };

    case "LAST_7":
      start.setDate(start.getDate() - 6);
      return { start, end, label: "Last 7 days" };

    case "LAST_30":
      start.setDate(start.getDate() - 29);
      return { start, end, label: "Last 30 days" };

    case "THIS_MONTH":
      start.setDate(1);
      return { start, end, label: "This month" };

    case "LAST_MONTH": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      // Last millisecond of the previous month, so the range never overlaps
      // the current one and a record cannot be counted in both.
      const to = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      to.setMilliseconds(to.getMilliseconds() - 1);
      return { start: from, end: to, label: "Last month" };
    }

    case "CUSTOM": {
      const from = filters.from ?? start;
      const to = filters.to ?? end;
      // A reversed range is a user slip, not an empty result set.
      const [a, b] = from <= to ? [from, to] : [to, from];
      const bound = new Date(b);
      bound.setHours(23, 59, 59, 999);
      return {
        start: new Date(a.setHours(0, 0, 0, 0)),
        end: bound,
        label: "Custom range",
      };
    }

    case "ALL":
    default:
      return { start: new Date(0), end, label: "All time" };
  }
}

/** Which dimension filters are actually applied, for the UI to state. */
export function activeDimensions(filters: AnalyticsFilters): string[] {
  const applied: string[] = [];
  if (filters.sourceId) applied.push("source");
  if (filters.campaignId) applied.push("campaign");
  if (filters.staffId) applied.push("staff");
  if (filters.automationId) applied.push("automation");
  if (filters.leadStageCode) applied.push("lead stage");
  if (filters.interestStatus) applied.push("interest status");
  return applied;
}

export function parseFilters(input: Record<string, unknown>): AnalyticsFilters {
  const parsed = analyticsFilters.safeParse(input);
  return parsed.success ? parsed.data : analyticsFilters.parse({});
}
