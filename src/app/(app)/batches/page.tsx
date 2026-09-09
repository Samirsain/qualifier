import Link from "next/link";
import { setBatchStatus } from "./actions";
import {
  Badge,
  Card,
  Cell,
  DistributionBar,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
} from "@/components/ui";
import {
  BATCH_STATUS_LABELS,
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABELS,
  type CustomerStatusKey,
  statusTone,
} from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const ORDER: CustomerStatusKey[] = [
  "NOT_STARTED",
  "IN_FUNNEL",
  "QUALIFIED",
  "NOT_INTERESTED",
  "NO_RESPONSE",
];

/**
 * The home screen. A batch is one upload of numbers put through one funnel,
 * so this list is the answer to "what is running right now" — and, per row,
 * how that upload is splitting across the five states.
 */
export default async function BatchesPage() {
  const user = await requirePermission("batch:read");
  const canManage = can(user.roles, "batch:manage");

  const [batches, byStatus] = await Promise.all([
    prisma.batch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        automation: { select: { id: true, name: true } },
        createdBy: { select: { displayName: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.customer.groupBy({
      by: ["batchId", "status"],
      where: { batchId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, Record<CustomerStatusKey, number>>();
  for (const row of byStatus) {
    if (!row.batchId) continue;
    const forBatch =
      counts.get(row.batchId) ??
      ({
        NOT_STARTED: 0,
        IN_FUNNEL: 0,
        QUALIFIED: 0,
        NOT_INTERESTED: 0,
        NO_RESPONSE: 0,
      } satisfies Record<CustomerStatusKey, number>);
    forBatch[row.status] = row._count._all;
    counts.set(row.batchId, forBatch);
  }

  return (
    <>
      <PageHeader
        title="Batches"
        description="Each batch is one upload of numbers run through one funnel. The funnel version is frozen when the batch is created, so editing a funnel never changes what a running batch sends."
        actions={
          canManage && (
            <Link href="/batches/new" className={buttonClass.primary}>
              Upload numbers
            </Link>
          )
        }
      />

      <Card
        flush={batches.length > 0}
        footer={
          batches.length > 0 ? (
            <span>
              {batches.length} batch{batches.length === 1 ? "" : "es"}
            </span>
          ) : undefined
        }
      >
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
            head={[
              "Batch",
              "Progress",
              "Qualified",
              "Status",
              ...(canManage ? [""] : []),
            ]}
          >
            {batches.map((b) => {
              const split = counts.get(b.id);
              const total = b._count.members;
              const qualified = split?.QUALIFIED ?? 0;
              const closed = (split?.NOT_INTERESTED ?? 0) + (split?.NO_RESPONSE ?? 0);

              return (
                <Row key={b.id}>
                  <Cell>
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/batches/${b.id}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {b.name}
                      </Link>
                      <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                        {b.automation.name}{" "}
                        <span className="font-[family-name:var(--font-mono)]">
                          v{b.automationVersion}
                        </span>{" "}
                        · {total} number{total === 1 ? "" : "s"} · by{" "}
                        {b.createdBy.displayName} on{" "}
                        {formatDate(b.createdAt)}
                      </span>
                    </div>
                  </Cell>

                  <Cell className="w-[300px]">
                    {split ? (
                      <div className="flex flex-col gap-1.5">
                        <DistributionBar
                          segments={ORDER.map((key) => ({
                            label: CUSTOMER_STATUS_LABELS[key],
                            value: split[key],
                            color: CUSTOMER_STATUS_COLOR[key],
                          }))}
                        />
                        <span className="text-[length:var(--text-small)] tabular-nums text-[color:var(--color-text-secondary)]">
                          {split.IN_FUNNEL} in funnel · {qualified} qualified ·{" "}
                          {closed} closed · {split.NOT_STARTED} not started
                        </span>
                      </div>
                    ) : (
                      <span className="text-[color:var(--color-text-secondary)]">
                        Nothing enrolled yet
                      </span>
                    )}
                  </Cell>

                  <Cell>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[length:var(--text-h2)] font-semibold tabular-nums text-[color:var(--color-status-success)]">
                        {qualified}
                      </span>
                      {total > 0 && (
                        <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          {Math.round((qualified / total) * 100)}%
                        </span>
                      )}
                    </div>
                  </Cell>

                  <Cell>
                    <Badge tone={statusTone(b.status)} dot>
                      {BATCH_STATUS_LABELS[b.status]}
                    </Badge>
                  </Cell>

                  {canManage && (
                    <Cell>
                      <div className="flex flex-wrap justify-end gap-2">
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
                        <Link
                          href={`/batches/${b.id}`}
                          className="self-center px-1 font-medium underline-offset-2 hover:underline"
                        >
                          Open
                        </Link>
                      </div>
                    </Cell>
                  )}
                </Row>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
