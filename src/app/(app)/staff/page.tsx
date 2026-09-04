import Link from "next/link";
import {
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, type RoleCode } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * UI-018 — Staff. Workload and ownership comparison (F-017, BR-29/34/47):
 * Customer → Responsible Staff → Next Action → Due Date → Outcome.
 *
 * These are raw counts, not a score. Scoring is DEV-012 and cannot run until
 * management approves weights (GAP-001).
 */
export default async function StaffPage() {
  await requirePermission("staff:read");

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const staff = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } },
    },
    orderBy: { displayName: "asc" },
    include: {
      userRoles: { include: { role: { select: { code: true } } } },
      staffProfile: { select: { staffCode: true, active: true } },
      _count: {
        select: {
          assignedCustomers: true,
          callsAssigned: true,
          meetingsAssigned: true,
        },
      },
    },
  });

  const ids = staff.map((s) => s.id);

  const [pendingFollowUps, overdueFollowUps, completedFollowUps, converted] =
    ids.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          prisma.followUp.groupBy({
            by: ["assignedStaffId"],
            where: { assignedStaffId: { in: ids }, status: "PENDING" },
            _count: { _all: true },
          }),
          prisma.followUp.groupBy({
            by: ["assignedStaffId"],
            where: {
              assignedStaffId: { in: ids },
              status: "PENDING",
              dueAt: { lt: startOfToday },
            },
            _count: { _all: true },
          }),
          prisma.followUp.groupBy({
            by: ["assignedStaffId"],
            where: { assignedStaffId: { in: ids }, status: "COMPLETED" },
            _count: { _all: true },
          }),
          prisma.customer.groupBy({
            by: ["assignedStaffId"],
            where: {
              assignedStaffId: { in: ids },
              interestStatus: "CONVERTED",
            },
            _count: { _all: true },
          }),
        ]);

  const countMap = (
    rows: { assignedStaffId: string | null; _count: { _all: number } }[],
  ) => new Map(rows.map((r) => [r.assignedStaffId, r._count._all]));

  const pending = countMap(pendingFollowUps);
  const overdue = countMap(overdueFollowUps);
  const completed = countMap(completedFollowUps);
  const conversions = countMap(converted);

  return (
    <>
      <PageHeader
        title="Staff"
        description="Workload and ownership. Counts only — scoring needs approved weights before it runs."
      />

      <Card>
        {staff.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Users with the CRM / Sales Staff or Manager role appear here."
          />
        ) : (
          <Table
            caption="Staff workload"
            head={[
              "Staff",
              "Role",
              "Assigned customers",
              "Pending follow-ups",
              "Overdue",
              "Completed",
              "Calls",
              "Meetings",
              "Converted",
            ]}
          >
            {staff.map((s) => {
              const overdueCount = overdue.get(s.id) ?? 0;
              return (
                <Row key={s.id}>
                  <Cell>
                    <Link
                      href={`/staff/${s.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {s.displayName}
                    </Link>
                    {s.staffProfile && (
                      <p className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                        {s.staffProfile.staffCode}
                      </p>
                    )}
                  </Cell>
                  <Cell>
                    {s.userRoles
                      .map((ur) => ROLE_LABELS[ur.role.code as RoleCode])
                      .join(", ")}
                  </Cell>
                  <Cell className="tabular-nums">{s._count.assignedCustomers}</Cell>
                  <Cell className="tabular-nums">{pending.get(s.id) ?? 0}</Cell>
                  <Cell
                    className={
                      overdueCount > 0
                        ? "tabular-nums font-medium text-[color:var(--color-status-error)]"
                        : "tabular-nums"
                    }
                  >
                    {overdueCount}
                  </Cell>
                  <Cell className="tabular-nums">{completed.get(s.id) ?? 0}</Cell>
                  <Cell className="tabular-nums">{s._count.callsAssigned}</Cell>
                  <Cell className="tabular-nums">{s._count.meetingsAssigned}</Cell>
                  <Cell className="tabular-nums">{conversions.get(s.id) ?? 0}</Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
