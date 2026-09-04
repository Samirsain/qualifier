import Link from "next/link";
import { notFound } from "next/navigation";
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
import {
  INTEREST_STATUS_LABELS,
  interestTone,
  statusTone,
  titleCase,
  type InterestStatusKey,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, type RoleCode } from "@/lib/rbac";
import { calculateScore } from "@/lib/scoring/calculate";
import { parseConfig } from "@/lib/scoring/config";
import { activeScoreConfig, extractFactors, periodFor } from "@/lib/scoring/extract";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * UI-019 — Staff Profile (doc 13 §7).
 *
 * Shows the source-defined factor *inputs* — assigned leads, contacted,
 * follow-ups completed, overdue, calls, meetings, qualified, conversions —
 * but no Overall Score. A score requires an approved configuration (GAP-001),
 * so an unweighted number would be a fabricated ranking.
 */
export default async function StaffProfilePage({
  params,
}: PageProps<"/staff/[id]">) {
  await requirePermission("staff:read");
  const { id } = await params;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const staff = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: { include: { role: { select: { code: true } } } },
      staffProfile: true,
    },
  });
  if (!staff) notFound();

  const [
    assignedCustomers,
    contacted,
    followUpsCompleted,
    followUpsOverdue,
    calls,
    meetings,
    qualified,
    conversions,
    book,
    recentAssignments,
  ] = await Promise.all([
    prisma.customer.count({ where: { assignedStaffId: id } }),
    // "Contacted" = an assigned customer with at least one outbound message.
    // The exact qualifying event is TBD in doc 13 §5; this is the auditable
    // stand-in and is labelled as such in the UI.
    prisma.customer.count({
      where: {
        assignedStaffId: id,
        messages: { some: { direction: "OUTBOUND" } },
      },
    }),
    prisma.followUp.count({ where: { assignedStaffId: id, status: "COMPLETED" } }),
    prisma.followUp.count({
      where: { assignedStaffId: id, status: "PENDING", dueAt: { lt: startOfToday } },
    }),
    prisma.call.count({ where: { assignedStaffId: id } }),
    prisma.meeting.count({ where: { assignedStaffId: id } }),
    prisma.lead.count({
      where: { assignedStaffId: id, stage: { code: "QUALIFIED" } },
    }),
    prisma.customer.count({
      where: { assignedStaffId: id, interestStatus: "CONVERTED" },
    }),
    prisma.customer.findMany({
      where: { assignedStaffId: id },
      orderBy: { nextFollowUpAt: { sort: "asc", nulls: "last" } },
      take: 25,
      include: {
        lead: { include: { stage: { select: { name: true } } } },
        followUps: {
          where: { status: "PENDING" },
          orderBy: { dueAt: "asc" },
          take: 1,
        },
      },
    }),
    prisma.staffAssignment.findMany({
      where: { staffId: id },
      orderBy: { assignedAt: "desc" },
      take: 15,
      include: {
        customer: { select: { id: true, name: true } },
        assignedBy: { select: { displayName: true } },
      },
    }),
  ]);

  // A score exists only when management has activated a configuration.
  const activeConfig = await activeScoreConfig();
  const scorePeriod = periodFor("MONTHLY");
  const score = activeConfig
    ? await extractFactors(id, scorePeriod).then(({ values, assignedCustomers }) =>
        calculateScore(parseConfig(activeConfig.factorConfig), values, {
          assignedCustomers,
        }),
      )
    : null;

  return (
    <>
      <PageHeader
        title={staff.displayName}
        description={`${staff.userRoles.map((ur) => ROLE_LABELS[ur.role.code as RoleCode]).join(", ")} · ${staff.email}`}
        actions={
          <Link href="/staff" className="underline-offset-2 hover:underline">
            Back to staff
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        <StatTile label="Assigned" value={assignedCustomers} />
        <StatTile label="Contacted" value={contacted} hint="Has an outbound message" />
        <StatTile label="Follow-ups done" value={followUpsCompleted} />
        <StatTile label="Overdue" value={followUpsOverdue} />
        <StatTile label="Calls" value={calls} />
        <StatTile label="Meetings" value={meetings} />
        <StatTile label="Qualified" value={qualified} />
        <StatTile label="Converted" value={conversions} />
      </div>

      <Card title="Overall score" className="mt-4">
        {!activeConfig ? (
          <p className="text-[color:var(--color-text-secondary)]">
            No score is shown. Doc 13 §4 requires that a production ranking
            formula is not shipped until management approves weights,
            normalisation, caps and attribution (GAP-001). The factor inputs
            above are the raw measures that formula will consume.
          </p>
        ) : !score?.ok ? (
          <>
            <p className="text-[color:var(--color-status-warning)]">
              {score?.reason ?? "No score could be calculated."}
            </p>
            {score && !score.ok && (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[length:var(--text-small)]">
                {score.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-[length:var(--text-display)] font-semibold tabular-nums">
                {score.score}
              </span>
              <span className="text-[color:var(--color-text-secondary)]">
                {activeConfig.name} · {scorePeriod.start.toLocaleDateString()} —{" "}
                {scorePeriod.end.toLocaleDateString()}
              </span>
              {score.belowSampleSize && (
                <Badge tone="warning">Below minimum sample size — not ranked</Badge>
              )}
              {score.clampedAtZero && <Badge tone="warning">Clamped at zero</Badge>}
              {score.clampedAtCeiling && <Badge tone="warning">At ceiling</Badge>}
            </div>

            {/* Doc 13 §10 — every score must show its own derivation. */}
            <Table
              caption="Score breakdown"
              head={["Factor", "Raw", "Normalisation", "Normalised", "Weight", "Contribution"]}
            >
              {score.contributions.map((c) => (
                <Row key={c.key}>
                  <Cell>
                    {c.label}
                    {c.caveat && (
                      <p className="max-w-md text-[length:var(--text-small)] text-[color:var(--color-status-warning)]">
                        {c.caveat}
                      </p>
                    )}
                  </Cell>
                  <Cell className="tabular-nums">{c.raw}</Cell>
                  <Cell>{titleCase(c.normalisation)}</Cell>
                  <Cell className="tabular-nums">{c.normalised.toFixed(4)}</Cell>
                  <Cell className="tabular-nums">{c.weight}</Cell>
                  <Cell
                    className={
                      c.contribution < 0
                        ? "tabular-nums font-medium text-[color:var(--color-status-error)]"
                        : "tabular-nums font-medium"
                    }
                  >
                    {c.contribution.toFixed(4)}
                  </Cell>
                </Row>
              ))}
            </Table>
          </>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Assigned customers and next action">
          {book.length === 0 ? (
            <EmptyState
              title="No customers assigned"
              description="Assign customers from a customer profile or the leads list."
            />
          ) : (
            <Table
              caption="Assigned customers"
              head={["Customer", "Stage", "Interest", "Next action", "Due"]}
            >
              {book.map((c) => (
                <Row key={c.id}>
                  <Cell>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </Cell>
                  <Cell>{c.lead?.stage.name ?? "—"}</Cell>
                  <Cell>
                    <Badge tone={interestTone(c.interestStatus)}>
                      {INTEREST_STATUS_LABELS[c.interestStatus as InterestStatusKey]}
                    </Badge>
                  </Cell>
                  <Cell>{c.followUps[0]?.type ?? "None scheduled"}</Cell>
                  <Cell>
                    {c.followUps[0] ? (
                      <Badge
                        tone={
                          c.followUps[0].dueAt < startOfToday
                            ? "error"
                            : statusTone("PENDING")
                        }
                      >
                        {c.followUps[0].dueAt.toLocaleDateString()}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Assignment history">
          {recentAssignments.length === 0 ? (
            <EmptyState title="No assignment history" />
          ) : (
            <Table
              caption="Assignment history"
              head={["Customer", "Assigned", "Ended", "By", "Reason"]}
            >
              {recentAssignments.map((a) => (
                <Row key={a.id}>
                  <Cell>
                    <Link
                      href={`/customers/${a.customer.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {a.customer.name}
                    </Link>
                  </Cell>
                  <Cell>{a.assignedAt.toLocaleString()}</Cell>
                  <Cell>
                    {a.endedAt ? (
                      a.endedAt.toLocaleString()
                    ) : (
                      <Badge tone="success">{titleCase("CURRENT")}</Badge>
                    )}
                  </Cell>
                  <Cell>{a.assignedBy?.displayName ?? "System"}</Cell>
                  <Cell>{a.reason ?? "—"}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
