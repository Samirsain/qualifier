import "server-only";
import { logActivity } from "@/lib/activity";
import { enrolCustomer } from "@/lib/automation/entry";
import { prisma } from "@/lib/prisma";

/**
 * A batch is a frozen list of numbers against one version of one funnel.
 *
 * Members are enrolled in slices rather than all at once, so a large upload
 * does not hold a single request open, and a stop takes effect between slices.
 */

const SLICE = 50;

export type DispatchResult = {
  batchId: string;
  enrolled: number;
  skipped: number;
  remaining: number;
  stopped: boolean;
};

export async function startBatch(batchId: string): Promise<{ enrolled: number }> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, name: true, automationId: true },
  });
  if (!batch || batch.status !== "DRAFT") return { enrolled: 0 };

  await prisma.batch.update({
    where: { id: batchId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  await logActivity({
    eventType: "batch.started",
    objectType: "batch",
    objectId: batchId,
    metadata: { name: batch.name },
  });

  const result = await dispatchBatch(batchId);
  return { enrolled: result.enrolled };
}

export async function dispatchBatch(
  batchId: string,
  limit = SLICE,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    batchId,
    enrolled: 0,
    skipped: 0,
    remaining: 0,
    stopped: false,
  };

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, automationId: true, name: true },
  });
  if (!batch || batch.status !== "RUNNING") {
    result.stopped = true;
    return result;
  }

  const pending = await prisma.batchMember.findMany({
    where: { batchId, enrolledAt: null, skippedReason: null },
    take: limit,
    select: { customerId: true },
  });

  for (const { customerId } of pending) {
    // Re-read status before each enrolment so a stop lands immediately
    // rather than at the end of the slice.
    const current = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (current?.status !== "RUNNING") {
      result.stopped = true;
      break;
    }

    const enrolled = await enrolCustomer({
      automationId: batch.automationId,
      customerId,
    });

    if (enrolled.ok) {
      await prisma.$transaction([
        prisma.batchMember.update({
          where: { batchId_customerId: { batchId, customerId } },
          data: { enrolledAt: new Date() },
        }),
        prisma.customer.update({
          where: { id: customerId },
          data: { status: "IN_FUNNEL" },
        }),
      ]);
      result.enrolled++;
    } else {
      await prisma.batchMember.update({
        where: { batchId_customerId: { batchId, customerId } },
        data: { skippedReason: enrolled.reason },
      });
      result.skipped++;
    }
  }

  result.remaining = await prisma.batchMember.count({
    where: { batchId, enrolledAt: null, skippedReason: null },
  });

  if (result.remaining === 0 && !result.stopped) {
    await prisma.batch.updateMany({
      where: { id: batchId, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await logActivity({
      eventType: "batch.completed",
      objectType: "batch",
      objectId: batchId,
      metadata: { name: batch.name },
    });
  }

  return result;
}

export async function dispatchRunningBatches(): Promise<DispatchResult[]> {
  const running = await prisma.batch.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  const results: DispatchResult[] = [];
  for (const b of running) results.push(await dispatchBatch(b.id));
  return results;
}

/** Counts by customer status for one batch. */
export async function batchProgress(batchId: string) {
  const rows = await prisma.customer.groupBy({
    by: ["status"],
    where: { batchMembers: { some: { batchId } } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {
    NOT_STARTED: 0,
    IN_FUNNEL: 0,
    QUALIFIED: 0,
    NOT_INTERESTED: 0,
    NO_RESPONSE: 0,
  };
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}
