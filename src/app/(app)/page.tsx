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
} from "@/components/ui";
import { computeMetrics } from "@/lib/analytics/compute";
import { parseFilters } from "@/lib/analytics/filters";
import { INTEREST_STATUS_LABELS, interestTone, type InterestStatusKey } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can, customerScope } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * UI-002 — Dashboard. Source-defined top metrics (BR-43): Total Customers,
 * New Leads, Interested, Follow-ups Due, Calls, Meetings — plus the
 * operational queues that answer WHO / WHAT / WHO RESPONSIBLE / WHAT RESULT.
 *
 * The summary numbers come from `computeMetrics`, the same function the
 * analytics page uses. Doc 12 §1 requires that dashboards and reports apply
 * identical KPI definitions; sharing the computation is how that is enforced
 * rather than merely intended.
 */
export default async function DashboardPage() {
  const user = await requirePermission("customer:read");
  const scope = customerScope(user.roles, user.id);
  // Staff see only their own queues; managers, admins and viewers see all.
  const ownScope = can(user.roles, "customer:read_all")
    ? {}
    : { assignedStaffId: user.id };

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  // Dashboard headline figures are current-state, so the metric period is
  // all-time; the follow-up queue below is the time-bounded part.
  const { values } = await computeMetrics(parseFilters({ range: "ALL" }), scope, [
    "total_customers",
    "leads_new",
    "leads_interested",
    "calls",
    "meetings",
  ]);

  const [followUpsDue, dueList, recentCustomers, pipeline, stages] = await Promise.all([
    prisma.followUp.count({
      where: { status: "PENDING", dueAt: { lt: endOfToday }, ...ownScope },
    }),
    prisma.followUp.findMany({
      where: { status: "PENDING", dueAt: { lt: endOfToday }, ...ownScope },
      orderBy: { dueAt: "asc" },
      take: 8,
      include: {
        customer: { select: { id: true, name: true } },
        assignedStaff: { select: { displayName: true } },
      },
    }),
    prisma.customer.findMany({
      where: scope,
      orderBy: { lastInteractionAt: { sort: "desc", nulls: "last" } },
      take: 8,
      include: {
        source: { select: { name: true } },
        assignedStaff: { select: { displayName: true } },
      },
    }),
    prisma.lead.groupBy({ by: ["stageId"], _count: { _all: true } }),
    prisma.leadStage.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const countByStage = new Map(pipeline.map((p) => [p.stageId, p._count._all]));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Who came in, what is pending, who is responsible and what the result was."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total Customers" value={values.total_customers ?? 0} href="/customers" />
        <StatTile label="New Leads" value={values.leads_new ?? 0} href="/leads?stage=NEW" />
        <StatTile
          label="Interested"
          value={values.leads_interested ?? 0}
          href="/customers?interest=INTERESTED"
        />
        <StatTile label="Follow-ups Due" value={followUpsDue} href="/follow-ups" />
        <StatTile label="Calls" value={values.calls ?? 0} href="/follow-ups?tab=calls" />
        <StatTile label="Meetings" value={values.meetings ?? 0} href="/follow-ups?tab=meetings" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card
          title="Follow-ups due and overdue"
          actions={
            <Link
              href="/analytics"
              className="text-[length:var(--text-small)] underline-offset-2 hover:underline"
            >
              Full analytics
            </Link>
          }
        >
          {dueList.length === 0 ? (
            <EmptyState
              title="Nothing due"
              description="No pending follow-ups are due today or overdue for your book of customers."
            />
          ) : (
            <Table head={["Customer", "Due", "Owner", "Type"]} caption="Follow-ups due">
              {dueList.map((f) => {
                const overdue = f.dueAt < startOfToday;
                return (
                  <Row key={f.id}>
                    <Cell>
                      <Link
                        href={`/customers/${f.customer.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {f.customer.name}
                      </Link>
                    </Cell>
                    <Cell>
                      <Badge tone={overdue ? "error" : "warning"}>
                        {overdue ? "Overdue" : "Due"} · {f.dueAt.toLocaleDateString()}
                      </Badge>
                    </Cell>
                    <Cell>{f.assignedStaff.displayName}</Cell>
                    <Cell>{f.type}</Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Lead pipeline">
          {stages.length === 0 ? (
            <EmptyState
              title="No stages configured"
              description="Run the seed to load the ten source-defined lead stages."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {stages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/leads?stage=${s.code}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="tabular-nums font-medium">
                    {countByStage.get(s.id) ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent customer activity" className="mt-4">
        {recentCustomers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Customers appear here once they arrive from a campaign, a form, or manual entry."
          />
        ) : (
          <Table
            head={["Customer", "Source", "Interest", "Owner", "Last interaction"]}
            caption="Recent customers"
          >
            {recentCustomers.map((c) => (
              <Row key={c.id}>
                <Cell>
                  <Link
                    href={`/customers/${c.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                </Cell>
                <Cell>{c.source.name}</Cell>
                <Cell>
                  <Badge tone={interestTone(c.interestStatus)}>
                    {INTEREST_STATUS_LABELS[c.interestStatus as InterestStatusKey]}
                  </Badge>
                </Cell>
                <Cell>{c.assignedStaff?.displayName ?? "Unassigned"}</Cell>
                <Cell>{c.lastInteractionAt?.toLocaleString() ?? "—"}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
