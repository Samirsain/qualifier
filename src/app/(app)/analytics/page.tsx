import Link from "next/link";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  StatTile,
  Table,
  buttonClass,
  inputClass,
} from "@/components/ui";
import {
  METRICS,
  metricsInGroup,
  type MetricDefinition,
  type MetricGroup,
} from "@/lib/analytics/definitions";
import {
  computeMetrics,
  sourcePerformance,
  sourceToStaff,
  type MetricValues,
} from "@/lib/analytics/compute";
import { activeDimensions, parseFilters } from "@/lib/analytics/filters";
import { INTEREST_STATUS_LABELS } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { customerScope } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const GROUP_TITLES: Record<MetricGroup, string> = {
  customer: "Customers",
  communication: "Communication",
  lead: "Leads",
  staff: "Staff",
  campaign: "Campaigns",
  automation: "Automations",
};

/**
 * UI-022 — Analytics (doc 12).
 *
 * Values come from `computeMetrics`, the same function the dashboard calls, so
 * a label cannot mean two different things in two places (§1, §11). Every
 * metric can show its own definition — population, numerator, denominator and
 * time field — which is what §1 asks for.
 */
export default async function AnalyticsPage({
  searchParams,
}: PageProps<"/analytics">) {
  const user = await requirePermission("report:read");
  const params = await searchParams;

  const filters = parseFilters(params);
  const scope = customerScope(user.roles, user.id);

  const [{ period, values }, bySource, bySourceStaff, sources, campaigns, staff, automations, stages] =
    await Promise.all([
      computeMetrics(filters, scope),
      sourcePerformance(filters, scope),
      sourceToStaff(filters, scope),
      prisma.source.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: {
          status: "ACTIVE",
          userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } },
        },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true },
      }),
      prisma.automation.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.leadStage.findMany({
        orderBy: { sortOrder: "asc" },
        select: { code: true, name: true },
      }),
    ]);

  const applied = activeDimensions(filters);

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`${period.label} · ${period.start.toLocaleDateString()} — ${period.end.toLocaleDateString()}${
          applied.length > 0 ? ` · filtered by ${applied.join(", ")}` : ""
        }`}
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Period
            </span>
            <select name="range" defaultValue={filters.range} className={inputClass}>
              <option value="TODAY">Today</option>
              <option value="LAST_7">Last 7 days</option>
              <option value="LAST_30">Last 30 days</option>
              <option value="THIS_MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              <option value="ALL">All time</option>
              <option value="CUSTOM">Custom range</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              From
            </span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from?.toISOString().slice(0, 10) ?? ""}
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              To
            </span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to?.toISOString().slice(0, 10) ?? ""}
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Source
            </span>
            <select name="sourceId" defaultValue={filters.sourceId} className={inputClass}>
              <option value="">All</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Campaign
            </span>
            <select name="campaignId" defaultValue={filters.campaignId} className={inputClass}>
              <option value="">All</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Staff
            </span>
            <select name="staffId" defaultValue={filters.staffId} className={inputClass}>
              <option value="">All</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Automation
            </span>
            <select
              name="automationId"
              defaultValue={filters.automationId}
              className={inputClass}
            >
              <option value="">All</option>
              {automations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Lead stage
            </span>
            <select
              name="leadStageCode"
              defaultValue={filters.leadStageCode}
              className={inputClass}
            >
              <option value="">All</option>
              {stages.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Interest
            </span>
            <select
              name="interestStatus"
              defaultValue={filters.interestStatus}
              className={inputClass}
            >
              <option value="">All</option>
              {Object.entries(INTEREST_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Apply
          </button>
          <Link href="/analytics" className={buttonClass.secondary}>
            Reset
          </Link>
        </form>

        <p className="mt-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          Period boundaries use the server timezone. The reporting business
          timezone is a pending decision (GAP-020), so date-based figures are
          not yet anchored to an approved zone. No test or internal records are
          excluded — that population rule is also undecided (GAP-035).
        </p>
      </Card>

      {(["customer", "communication", "lead", "staff", "campaign", "automation"] as MetricGroup[]).map(
        (group) => (
          <MetricSection
            key={group}
            title={GROUP_TITLES[group]}
            metrics={metricsInGroup(group)}
            values={values}
          />
        ),
      )}

      <Card title="Source performance" className="mt-4">
        <p className="mb-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          Customers → Interested → Calls → Meetings → Conversions, by the source
          recorded when each customer entered. History is never rewritten
          retroactively.
        </p>
        {bySource.length === 0 ? (
          <EmptyState
            title="No source activity in this period"
            description="Sources appear once customers are recorded against them."
          />
        ) : (
          <Table
            caption="Source performance"
            head={[
              "Source",
              "Customers",
              "Interested",
              "Calls",
              "Meetings",
              "Conversions",
              "Interest rate",
            ]}
          >
            {bySource.map((r) => (
              <Row key={r.source.id}>
                <Cell className="font-medium">{r.source.name}</Cell>
                <Cell className="tabular-nums">{r.total}</Cell>
                <Cell className="tabular-nums">{r.interested}</Cell>
                <Cell className="tabular-nums">{r.calls}</Cell>
                <Cell className="tabular-nums">{r.meetings}</Cell>
                <Cell className="tabular-nums">{r.conversions}</Cell>
                <Cell className="tabular-nums">
                  {r.total > 0 ? `${((r.interested / r.total) * 100).toFixed(1)}%` : "—"}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Source to responsible staff" className="mt-4">
        {bySourceStaff.length === 0 ? (
          <EmptyState title="No assigned customers in this scope" />
        ) : (
          <Table caption="Source to staff" head={["Source", "Responsible staff", "Customers"]}>
            {bySourceStaff.slice(0, 40).map((r, i) => (
              <Row key={i}>
                <Cell>{r.source}</Cell>
                <Cell>{r.staff}</Cell>
                <Cell className="tabular-nums">{r.customers}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function MetricSection({
  title,
  metrics,
  values,
}: {
  title: string;
  metrics: MetricDefinition[];
  values: MetricValues;
}) {
  return (
    <Card title={title} className="mt-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m) => {
          const value = values[m.key];
          const unavailable = value === null || value === undefined;
          return (
            <StatTile
              key={m.key}
              label={m.label}
              value={
                unavailable ? (
                  <span className="text-[length:var(--text-h3)] text-[color:var(--color-text-secondary)]">
                    Not defined
                  </span>
                ) : m.key === "response_rate" ? (
                  `${(value * 100).toFixed(1)}%`
                ) : (
                  value
                )
              }
              hint={m.denominator ? `of ${m.denominator}` : undefined}
            />
          );
        })}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          Metric definitions
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-[length:var(--text-small)]">
            <thead>
              <tr className="border-b border-[color:var(--color-border-default)]">
                {["Metric", "Population", "Numerator", "Denominator", "Time field"].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-2 py-2 font-medium text-[color:var(--color-text-secondary)]"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr
                  key={m.key}
                  className="border-b border-[color:var(--color-border-default)] last:border-0"
                >
                  <td className="px-2 py-2 font-medium">
                    {m.label}
                    {m.pendingDecision && (
                      <p className="font-normal text-[color:var(--color-status-warning)]">
                        {m.pendingDecision}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2">{m.population}</td>
                  <td className="px-2 py-2">{m.numerator}</td>
                  <td className="px-2 py-2">{m.denominator ?? "—"}</td>
                  <td className="px-2 py-2">{m.timeField}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {metrics.some((m) => METRICS[m.key].pendingDecision) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics
            .filter((m) => m.pendingDecision)
            .map((m) => (
              <Badge key={m.key} tone="warning">
                {m.label} — see definition
              </Badge>
            ))}
        </div>
      )}
    </Card>
  );
}
