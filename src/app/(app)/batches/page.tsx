import Link from "next/link";
import { setBatchStatus } from "./actions";
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
import { BATCH_STATUS_LABELS, statusTone } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The home screen. A batch is one upload of numbers put through one funnel,
 * so this list is the answer to "what is running right now".
 */
export default async function BatchesPage() {
  const user = await requirePermission("batch:read");
  const canManage = can(user.roles, "batch:manage");

  const batches = await prisma.batch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      automation: { select: { id: true, name: true } },
      createdBy: { select: { displayName: true } },
      _count: { select: { members: true } },
    },
  });

  const qualified = await prisma.batchMember.groupBy({
    by: ["batchId"],
    where: { customer: { status: "QUALIFIED" } },
    _count: { _all: true },
  });
  const qualifiedByBatch = new Map(qualified.map((q) => [q.batchId, q._count._all]));

  return (
    <>
      <PageHeader
        title="Batches"
        description="Each batch is one upload of numbers run through one funnel. The funnel version is frozen when the batch is created."
        actions={
          canManage && (
            <Link href="/batches/new" className={buttonClass.primary}>
              Upload numbers
            </Link>
          )
        }
      />

      <Card>
        {batches.length === 0 ? (
          <EmptyState
            title="No batches yet"
            description="Upload a list of numbers and pick a live funnel to run them through."
            action={
              canManage && (
                <Link href="/batches/new" className={buttonClass.primary}>
                  Upload numbers
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption="Batches"
            head={[
              "Batch",
              "Funnel",
              "Status",
              "Numbers",
              "Qualified",
              "Created by",
              "Created",
              ...(canManage ? ["Controls"] : []),
            ]}
          >
            {batches.map((b) => (
              <Row key={b.id}>
                <Cell>
                  <Link
                    href={`/batches/${b.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {b.name}
                  </Link>
                </Cell>
                <Cell>
                  <Link
                    href={`/funnels/${b.automation.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {b.automation.name}
                  </Link>{" "}
                  <span className="text-[color:var(--color-text-secondary)]">
                    v{b.automationVersion}
                  </span>
                </Cell>
                <Cell>
                  <Badge tone={statusTone(b.status)}>
                    {BATCH_STATUS_LABELS[b.status]}
                  </Badge>
                </Cell>
                <Cell className="tabular-nums">{b._count.members}</Cell>
                <Cell className="tabular-nums">{qualifiedByBatch.get(b.id) ?? 0}</Cell>
                <Cell>{b.createdBy.displayName}</Cell>
                <Cell>{b.createdAt.toLocaleDateString()}</Cell>
                {canManage && (
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      {b.status === "RUNNING" && (
                        <form action={setBatchStatus}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="status" value="PAUSED" />
                          <button type="submit" className={buttonClass.secondary}>
                            Pause
                          </button>
                        </form>
                      )}
                      {b.status === "PAUSED" && (
                        <form action={setBatchStatus}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="status" value="RUNNING" />
                          <button type="submit" className={buttonClass.secondary}>
                            Resume
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
    </>
  );
}
