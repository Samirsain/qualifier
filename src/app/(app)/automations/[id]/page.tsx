import Link from "next/link";
import { notFound } from "next/navigation";
import { setAutomationStatus, stopCustomerRun } from "../actions";
import { ActivateButton } from "./activate";
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
import { AUTOMATION_STATUS_LABELS, statusTone, titleCase } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { validateAutomation } from "@/lib/automation/validate";

export const dynamic = "force-dynamic";

/**
 * UI-013 Automation Builder (read-only step map) + UI-014 Automation Details.
 *
 * Preview per doc 07 §16 is the step map plus the validation report — it shows
 * management the journey and what would block activation, without messaging
 * a single customer.
 */
export default async function AutomationDetailPage({
  params,
}: PageProps<"/automations/[id]">) {
  const user = await requirePermission("automation:read");
  const { id } = await params;

  const automation = await prisma.automation.findUnique({
    where: { id },
    include: {
      createdBy: { select: { displayName: true } },
      steps: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!automation) notFound();

  const [problems, runCounts, recentRuns, recentEvents] = await Promise.all([
    validateAutomation(id),
    prisma.automationRun.groupBy({
      by: ["state"],
      where: { automationId: id },
      _count: { _all: true },
    }),
    prisma.automationRun.findMany({
      where: { automationId: id },
      orderBy: { enteredAt: "desc" },
      take: 25,
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.automationEvent.findMany({
      where: { run: { automationId: id } },
      orderBy: { occurredAt: "desc" },
      take: 30,
      include: { run: { select: { customer: { select: { name: true } } } } },
    }),
  ]);

  const countByState = new Map(runCounts.map((r) => [r.state, r._count._all]));
  const canPause = can(user.roles, "automation:pause");

  return (
    <>
      <PageHeader
        title={automation.name}
        description={automation.description ?? titleCase(automation.type)}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(automation.status)}>
              {AUTOMATION_STATUS_LABELS[automation.status]}
            </Badge>
            {can(user.roles, "automation:activate") &&
              automation.status !== "ACTIVE" && (
                <ActivateButton id={automation.id} blocked={problems.length > 0} />
              )}
            {canPause && automation.status === "ACTIVE" && (
              <form action={setAutomationStatus}>
                <input type="hidden" name="id" value={automation.id} />
                <input type="hidden" name="status" value="PAUSED" />
                <button type="submit" className={buttonClass.secondary}>
                  Pause
                </button>
              </form>
            )}
            {canPause && automation.status !== "DISABLED" && (
              <form action={setAutomationStatus}>
                <input type="hidden" name="id" value={automation.id} />
                <input type="hidden" name="status" value="DISABLED" />
                <button type="submit" className={buttonClass.secondary}>
                  Disable
                </button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Entered" value={runCounts.reduce((a, r) => a + r._count._all, 0)} />
        <StatTile label="Running" value={countByState.get("RUNNING") ?? 0} />
        <StatTile label="Waiting" value={countByState.get("WAITING") ?? 0} />
        <StatTile label="Completed" value={countByState.get("COMPLETED") ?? 0} />
        <StatTile label="Stopped" value={countByState.get("STOPPED") ?? 0} />
        <StatTile label="Failed" value={countByState.get("FAILED") ?? 0} />
      </div>

      <Card title="Validation" className="mt-4">
        {problems.length === 0 ? (
          <p className="text-[color:var(--color-status-success)]">
            No structural problems. Branch targets resolve, every step is
            reachable, waits are configured and templates are available.
          </p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {problems.map((p, i) => (
              <li key={i} className="text-[color:var(--color-status-error)]">
                {p}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Journey steps" className="mt-4">
        {automation.steps.length === 0 ? (
          <EmptyState title="No steps defined" />
        ) : (
          <Table
            caption="Journey steps"
            head={["#", "Step key", "Type", "Configuration", "Next"]}
          >
            {automation.steps.map((s) => (
              <Row key={s.id}>
                <Cell className="tabular-nums">{s.sortOrder}</Cell>
                <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                  {s.stepKey}
                </Cell>
                <Cell>
                  <Badge>{titleCase(s.stepType)}</Badge>
                </Cell>
                <Cell>
                  <pre className="max-w-xl overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--color-surface-muted)] p-2 text-[length:var(--text-small)]">
                    {JSON.stringify(s.config, null, 2)}
                  </pre>
                </Cell>
                <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                  {s.nextStepKey ?? "end"}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Affected customers">
          {recentRuns.length === 0 ? (
            <EmptyState
              title="No customers in this journey"
              description="Runs appear once a customer enters."
            />
          ) : (
            <Table
              caption="Runs"
              head={[
                "Customer",
                "State",
                "Current step",
                "Next action",
                ...(canPause ? ["Stop"] : []),
              ]}
            >
              {recentRuns.map((run) => (
                <Row key={run.id}>
                  <Cell>
                    <Link
                      href={`/customers/${run.customer.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {run.customer.name}
                    </Link>
                  </Cell>
                  <Cell>
                    <Badge tone={statusTone(run.state)}>{titleCase(run.state)}</Badge>
                    {run.stopReason && (
                      <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                        {run.stopReason}
                      </p>
                    )}
                  </Cell>
                  <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                    {run.currentStepKey ?? "—"}
                  </Cell>
                  <Cell>{run.nextActionAt?.toLocaleString() ?? "—"}</Cell>
                  {canPause && (
                    <Cell>
                      {["RUNNING", "WAITING", "PAUSED"].includes(run.state) && (
                        <form action={stopCustomerRun} className="flex gap-2">
                          <input type="hidden" name="runId" value={run.id} />
                          <input
                            name="reason"
                            className={inputClass}
                            placeholder="Reason"
                            aria-label={`Stop reason for ${run.customer.name}`}
                          />
                          <button type="submit" className={buttonClass.danger}>
                            Stop
                          </button>
                        </form>
                      )}
                    </Cell>
                  )}
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Activity">
          {recentEvents.length === 0 ? (
            <EmptyState title="No events yet" />
          ) : (
            <ol className="flex flex-col">
              {recentEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex gap-3 border-b border-[color:var(--color-border-default)] py-2 last:border-0"
                >
                  <time
                    dateTime={e.occurredAt.toISOString()}
                    className="w-40 shrink-0 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)] tabular-nums"
                  >
                    {e.occurredAt.toLocaleString()}
                  </time>
                  <div className="min-w-0">
                    <span className="font-medium">{e.eventType}</span>
                    <span className="text-[color:var(--color-text-secondary)]">
                      {" "}
                      · {e.run.customer.name}
                      {e.stepKey ? ` · ${e.stepKey}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
