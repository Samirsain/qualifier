import Link from "next/link";
import { notFound } from "next/navigation";
import { setBatchStatus, startBatchAction } from "../actions";
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
} from "@/components/ui";
import { batchProgress } from "@/lib/batches/runner";
import {
  BATCH_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  type CustomerStatusKey,
  statusTone,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One batch: how far it has got, and who is where.
 *
 * Skipped members stay on the list with their reason, because a number that
 * was never messaged is a question someone will ask later.
 */
export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("batch:read");
  const canManage = can(user.roles, "batch:manage");
  const { id } = await params;

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      automation: { select: { id: true, name: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  if (!batch) notFound();

  const [progress, members, pending] = await Promise.all([
    batchProgress(id),
    prisma.batchMember.findMany({
      where: { batchId: id },
      orderBy: [{ enrolledAt: "asc" }],
      take: 500,
      include: {
        customer: {
          select: { id: true, name: true, phoneE164: true, status: true },
        },
      },
    }),
    prisma.batchMember.count({
      where: { batchId: id, enrolledAt: null, skippedReason: null },
    }),
  ]);

  return (
    <>
      <PageHeader
        title={batch.name}
        description={`Running ${batch.automation.name} v${batch.automationVersion}, created by ${batch.createdBy.displayName}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(batch.status)}>
              {BATCH_STATUS_LABELS[batch.status]}
            </Badge>
            <Link href="/batches" className="underline-offset-2 hover:underline">
              All batches
            </Link>
          </div>
        }
      />

      {canManage && (
        <div className="mb-4 flex flex-wrap gap-2">
          {batch.status === "DRAFT" && (
            <form action={startBatchAction}>
              <input type="hidden" name="id" value={batch.id} />
              <button type="submit" className={buttonClass.primary}>
                Start batch
              </button>
            </form>
          )}
          {batch.status === "RUNNING" && (
            <form action={setBatchStatus}>
              <input type="hidden" name="id" value={batch.id} />
              <input type="hidden" name="status" value="PAUSED" />
              <button type="submit" className={buttonClass.secondary}>
                Pause
              </button>
            </form>
          )}
          {batch.status === "PAUSED" && (
            <form action={setBatchStatus}>
              <input type="hidden" name="id" value={batch.id} />
              <input type="hidden" name="status" value="RUNNING" />
              <button type="submit" className={buttonClass.secondary}>
                Resume
              </button>
            </form>
          )}
          {(batch.status === "RUNNING" || batch.status === "PAUSED") && (
            <form action={setBatchStatus}>
              <input type="hidden" name="id" value={batch.id} />
              <input type="hidden" name="status" value="STOPPED" />
              <button type="submit" className={buttonClass.danger}>
                Stop enrolling
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatusKey[]).map((key) => (
          <StatTile
            key={key}
            label={CUSTOMER_STATUS_LABELS[key]}
            value={progress[key] ?? 0}
          />
        ))}
      </div>

      {pending > 0 && (
        <Card className="mb-4">
          <p>
            {pending} number{pending === 1 ? "" : "s"} still to enrol. They go in
            slices as the worker ticks, so a stop takes effect between slices.
          </p>
        </Card>
      )}

      <Card title="Numbers in this batch">
        {members.length === 0 ? (
          <EmptyState title="This batch has no numbers." />
        ) : (
          <Table
            caption="Numbers in this batch"
            head={["Number", "Name", "Status", "Enrolled", "Skipped because"]}
          >
            {members.map((m) => (
              <Row key={m.customerId}>
                <Cell className="font-[family-name:var(--font-mono)]">
                  {m.customer.phoneE164}
                </Cell>
                <Cell>{m.customer.name ?? "—"}</Cell>
                <Cell>
                  <Badge tone={statusTone(m.customer.status)}>
                    {CUSTOMER_STATUS_LABELS[m.customer.status]}
                  </Badge>
                </Cell>
                <Cell>{m.enrolledAt ? m.enrolledAt.toLocaleString() : "—"}</Cell>
                <Cell>{m.skippedReason ?? "—"}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
