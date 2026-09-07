import Link from "next/link";
import { createFunnel, duplicateFunnel, setFunnelStatus } from "./actions";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { AUTOMATION_STATUS_LABELS, statusTone } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The funnel library. A funnel is the sequence of messages and questions a
 * batch of numbers is put through; the engine runs it, this screen owns it.
 */
export default async function FunnelsPage() {
  const user = await requirePermission("funnel:read");
  const canManage = can(user.roles, "funnel:manage");

  const funnels = await prisma.automation.findMany({
    where: { archivedAt: null },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      createdBy: { select: { displayName: true } },
      _count: { select: { steps: true, runs: true } },
    },
  });

  const runningBatches = await prisma.batch.groupBy({
    by: ["automationId"],
    where: { status: "RUNNING" },
    _count: { _all: true },
  });
  const runningByFunnel = new Map(
    runningBatches.map((b) => [b.automationId, b._count._all]),
  );

  return (
    <>
      <PageHeader
        title="Funnels"
        description="The message sequences a batch runs through. Edit a draft freely; editing a live funnel saves a new version so runs in flight keep theirs."
        actions={
          canManage && (
            <form action={createFunnel} className="flex items-center gap-2">
              <label className="sr-only" htmlFor="new-funnel-name">
                New funnel name
              </label>
              <input
                id="new-funnel-name"
                name="name"
                placeholder="New funnel name"
                className={inputClass}
              />
              <button type="submit" className={buttonClass.primary}>
                New funnel
              </button>
            </form>
          )
        }
      />

      <Card>
        {funnels.length === 0 ? (
          <EmptyState
            title="No funnels yet"
            description="Create one, add a message, a question and a Mark qualified step, then activate it."
          />
        ) : (
          <Table
            caption="Funnels"
            head={[
              "Name",
              "Status",
              "Steps",
              "Running batches",
              "Total runs",
              "Created by",
              ...(canManage ? ["Controls"] : []),
            ]}
          >
            {funnels.map((f) => (
              <Row key={f.id}>
                <Cell>
                  <Link
                    href={`/funnels/${f.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {f.name}
                  </Link>
                  {f.description && (
                    <p className="max-w-md truncate text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {f.description}
                    </p>
                  )}
                </Cell>
                <Cell>
                  <Badge tone={statusTone(f.status)}>
                    {AUTOMATION_STATUS_LABELS[f.status]}
                  </Badge>
                </Cell>
                <Cell className="tabular-nums">{f._count.steps}</Cell>
                <Cell className="tabular-nums">{runningByFunnel.get(f.id) ?? 0}</Cell>
                <Cell className="tabular-nums">{f._count.runs}</Cell>
                <Cell>{f.createdBy.displayName}</Cell>
                {canManage && (
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      {f.status === "ACTIVE" && (
                        <form action={setFunnelStatus}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="status" value="PAUSED" />
                          <button type="submit" className={buttonClass.secondary}>
                            Pause
                          </button>
                        </form>
                      )}
                      {f.status === "PAUSED" && (
                        <form action={setFunnelStatus}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <button type="submit" className={buttonClass.secondary}>
                            Resume
                          </button>
                        </form>
                      )}
                      <form action={duplicateFunnel}>
                        <input type="hidden" name="id" value={f.id} />
                        <button type="submit" className={buttonClass.secondary}>
                          Duplicate
                        </button>
                      </form>
                    </div>
                  </Cell>
                )}
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
