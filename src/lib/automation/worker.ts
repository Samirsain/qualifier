import "server-only";
import { prisma } from "@/lib/prisma";
import { advanceRun, isPausedAll } from "@/lib/automation/engine";

/**
 * Durable timer worker — the Temporal replacement described in the README.
 *
 * Claims runs whose `next_action_at` is due and advances them. The claim uses
 * `FOR UPDATE SKIP LOCKED` so two workers can never advance the same customer
 * run twice (doc 07 §13, explicit requirement).
 *
 * Idempotency lives in `automation_events.idempotency_key`, so even a claim
 * that is interrupted mid-flight cannot produce a duplicate send on retry.
 */

export type TickResult = {
  claimed: number;
  advanced: number;
  pausedAll: boolean;
  results: { runId: string; state: string; steps: number }[];
};

const DEFAULT_BATCH = 25;

export async function tick(batchSize = DEFAULT_BATCH): Promise<TickResult> {
  // Emergency control: pause-all halts every timer without losing state.
  if (await isPausedAll()) {
    return { claimed: 0, advanced: 0, pausedAll: true, results: [] };
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT r.id
      FROM automation_runs r
      JOIN automations a ON a.id = r."automationId"
      WHERE r.state = 'WAITING'
        AND r."nextActionAt" IS NOT NULL
        AND r."nextActionAt" <= now()
        AND a.status = 'ACTIVE'
      ORDER BY r."nextActionAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE OF r SKIP LOCKED
    `;

    if (due.length === 0) return [];

    const ids = due.map((r) => r.id);
    await tx.automationRun.updateMany({
      where: { id: { in: ids } },
      data: { state: "RUNNING", nextActionAt: null },
    });
    return ids;
  });

  const results: TickResult["results"] = [];
  for (const runId of claimed) {
    try {
      const result = await advanceRun(runId);
      results.push({ runId, state: result.state, steps: result.steps });
    } catch (err) {
      console.error("[automation] advance failed", runId, err);
      // Leave it claimable again rather than stranded in RUNNING.
      await prisma.automationRun.update({
        where: { id: runId },
        data: { state: "WAITING", nextActionAt: new Date(Date.now() + 60_000) },
      });
      results.push({ runId, state: "RETRY", steps: 0 });
    }
  }

  return {
    claimed: claimed.length,
    advanced: results.filter((r) => r.state !== "RETRY").length,
    pausedAll: false,
    results,
  };
}

/** Runs still parked on a timer — used by the "upcoming actions" safety view. */
export async function upcomingActions(limit = 50) {
  return prisma.automationRun.findMany({
    where: { state: "WAITING", nextActionAt: { not: null } },
    orderBy: { nextActionAt: "asc" },
    take: limit,
    include: {
      automation: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
  });
}
