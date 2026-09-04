import Link from "next/link";
import { duplicateAutomation, setAutomationStatus, setPauseAll } from "./actions";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
} from "@/components/ui";
import { AUTOMATION_STATUS_LABELS, statusTone, titleCase } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSetting } from "@/lib/settings";
import { requirePermission } from "@/lib/session";
import { upcomingActions } from "@/lib/automation/worker";

export const dynamic = "force-dynamic";

/**
 * UI-012 — Automations (F-009, BR-13…18).
 *
 * The source explicitly forbids an artificial small limit on the number of
 * journeys, so nothing here caps the library. Safety controls from BR-18 are
 * on this page: pause-all, per-automation pause, and upcoming actions.
 */
export default async function AutomationsPage() {
  const user = await requirePermission("automation:read");

  const [automations, pausedAll, upcoming] = await Promise.all([
    prisma.automation.findMany({
      where: { archivedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        createdBy: { select: { displayName: true } },
        _count: { select: { steps: true, runs: true } },
      },
    }),
    getSetting("automation.pause_all"),
    upcomingActions(10),
  ]);

  const activeRuns = await prisma.automationRun.groupBy({
    by: ["automationId"],
    where: { state: { in: ["RUNNING", "WAITING"] } },
    _count: { _all: true },
  });
  const activeByAutomation = new Map(
    activeRuns.map((r) => [r.automationId, r._count._all]),
  );

  const isPausedAll = pausedAll === true;
  const canPause = can(user.roles, "automation:pause");
  const canPauseAll = can(user.roles, "automation:pause_all");

  return (
    <>
      <PageHeader
        title="Automations"
        description="The journey library. No limit on how many journeys the business runs."
        actions={
          canPauseAll && (
            <form action={setPauseAll}>
              <input type="hidden" name="paused" value={isPausedAll ? "false" : "true"} />
              <button
                type="submit"
                className={isPausedAll ? buttonClass.primary : buttonClass.danger}
              >
                {isPausedAll ? "Resume all automations" : "Pause all automations"}
              </button>
            </form>
          )
        }
      />

      {isPausedAll && (
        <Card className="mb-4">
          <p role="alert" className="font-medium text-[color:var(--color-status-error)]">
            All automations are paused. No journey advances and no timer fires
            while this is on. Existing runs keep their state and resume where
            they stopped.
          </p>
        </Card>
      )}

      <Card className="mb-4">
        {automations.length === 0 ? (
          <EmptyState
            title="No automations yet"
            description="Seed the 3% Club introduction journey, or create one from the documented types."
          />
        ) : (
          <Table
            caption="Automations"
            head={[
              "Name",
              "Type",
              "Status",
              "Steps",
              "Active customers",
              "Total runs",
              "Created by",
              ...(canPause ? ["Controls"] : []),
            ]}
          >
            {automations.map((a) => (
              <Row key={a.id}>
                <Cell>
                  <Link
                    href={`/automations/${a.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {a.name}
                  </Link>
                  {a.description && (
                    <p className="max-w-md truncate text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {a.description}
                    </p>
                  )}
                </Cell>
                <Cell>{titleCase(a.type)}</Cell>
                <Cell>
                  <Badge tone={statusTone(a.status)}>
                    {AUTOMATION_STATUS_LABELS[a.status]}
                  </Badge>
                </Cell>
                <Cell className="tabular-nums">{a._count.steps}</Cell>
                <Cell className="tabular-nums">
                  {activeByAutomation.get(a.id) ?? 0}
                </Cell>
                <Cell className="tabular-nums">{a._count.runs}</Cell>
                <Cell>{a.createdBy.displayName}</Cell>
                {canPause && (
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      {a.status === "ACTIVE" ? (
                        <form action={setAutomationStatus}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="status" value="PAUSED" />
                          <button type="submit" className={buttonClass.secondary}>
                            Pause
                          </button>
                        </form>
                      ) : a.status === "PAUSED" ? (
                        <form action={setAutomationStatus}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <button type="submit" className={buttonClass.secondary}>
                            Resume
                          </button>
                        </form>
                      ) : null}
                      {can(user.roles, "automation:create") && (
                        <form action={duplicateAutomation}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className={buttonClass.secondary}>
                            Duplicate
                          </button>
                        </form>
                      )}
                    </div>
                  </Cell>
                )}
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Upcoming automated actions">
        {upcoming.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="Journeys waiting on a timer appear here before they fire."
          />
        ) : (
          <Table
            caption="Upcoming automated actions"
            head={["Due", "Customer", "Automation", "Step"]}
          >
            {upcoming.map((run) => (
              <Row key={run.id}>
                <Cell>
                  <Badge tone={run.nextActionAt! <= new Date() ? "warning" : "info"}>
                    {run.nextActionAt!.toLocaleString()}
                  </Badge>
                </Cell>
                <Cell>
                  <Link
                    href={`/customers/${run.customer.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {run.customer.name}
                  </Link>
                </Cell>
                <Cell>
                  <Link
                    href={`/automations/${run.automation.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {run.automation.name}
                  </Link>
                </Cell>
                <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                  {run.currentStepKey ?? "—"}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
