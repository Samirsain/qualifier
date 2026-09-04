import "server-only";
import { prisma } from "@/lib/prisma";
import { advanceRun, isPausedAll } from "@/lib/automation/engine";
import { entryConditions } from "@/lib/automation/types";

/**
 * Entry and re-entry (doc 07 §6).
 *
 * GAP-015 leaves re-entry frequency, cooldown and simultaneous-run policy
 * undecided. The default here is the restrictive reading — one active run per
 * customer per automation, no re-entry after a finished run — and it is
 * *configurable per automation* rather than assumed, exactly as §6 requires.
 */

export type EnrolResult =
  | { ok: true; runId: string }
  | { ok: false; reason: string };

export async function enrolCustomer(input: {
  automationId: string;
  customerId: string;
}): Promise<EnrolResult> {
  if (await isPausedAll()) {
    return { ok: false, reason: "All automations are paused." };
  }

  const automation = await prisma.automation.findUnique({
    where: { id: input.automationId },
    select: {
      id: true,
      version: true,
      status: true,
      entryConditions: true,
      _count: { select: { steps: true } },
    },
  });
  if (!automation) return { ok: false, reason: "Automation not found." };
  if (automation.status !== "ACTIVE") {
    return { ok: false, reason: "Only an Active automation can enrol customers." };
  }
  if (automation._count.steps === 0) {
    return { ok: false, reason: "This automation has no steps." };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, optedOutAt: true },
  });
  if (!customer) return { ok: false, reason: "Customer not found." };
  if (customer.optedOutAt) {
    return { ok: false, reason: "This customer has opted out of messaging." };
  }

  const rules = entryConditions.safeParse(automation.entryConditions ?? {});
  const allowReentry = rules.success ? rules.data.allowReentry : false;
  const cooldownHours = rules.success ? rules.data.reentryCooldownHours : null;

  const active = await prisma.automationRun.findFirst({
    where: {
      automationId: automation.id,
      customerId: customer.id,
      state: { in: ["RUNNING", "WAITING", "PAUSED"] },
    },
    select: { id: true },
  });
  if (active) {
    return { ok: false, reason: "This customer is already in this journey." };
  }

  const finished = await prisma.automationRun.findFirst({
    where: {
      automationId: automation.id,
      customerId: customer.id,
      state: { in: ["COMPLETED", "STOPPED", "FAILED"] },
    },
    orderBy: { enteredAt: "desc" },
    select: { completedAt: true, stoppedAt: true, enteredAt: true },
  });

  if (finished) {
    if (!allowReentry) {
      return {
        ok: false,
        reason:
          "Re-entry is not enabled for this automation (GAP-015 — pending business decision).",
      };
    }
    if (cooldownHours !== null) {
      const last =
        finished.completedAt ?? finished.stoppedAt ?? finished.enteredAt;
      const readyAt = new Date(last.getTime() + cooldownHours * 60 * 60 * 1000);
      if (readyAt > new Date()) {
        return {
          ok: false,
          reason: `Cooldown active until ${readyAt.toLocaleString()}.`,
        };
      }
    }
  }

  const firstStep = await prisma.automationStep.findFirst({
    where: { automationId: automation.id, version: automation.version },
    orderBy: { sortOrder: "asc" },
    select: { stepKey: true },
  });

  const run = await prisma.automationRun.create({
    data: {
      automationId: automation.id,
      automationVersion: automation.version,
      customerId: customer.id,
      state: "RUNNING",
      currentStepKey: firstStep?.stepKey ?? null,
    },
    select: { id: true },
  });

  await prisma.automationEvent.create({
    data: { runId: run.id, eventType: "run.entered" },
  });

  await advanceRun(run.id);
  return { ok: true, runId: run.id };
}
