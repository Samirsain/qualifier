import "server-only";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";
import { sendToCustomer } from "@/lib/whatsapp/outbound";
import {
  actionConfig,
  branchConfig,
  conditionConfig,
  normaliseAnswer,
  waitConfig,
  type WaitConfig,
} from "@/lib/automation/types";

/**
 * Automation runtime (doc 07).
 *
 * Runs advance step by step. A run parks in WAITING either on a timer
 * (`next_action_at`) or on a pending question; nothing lives in worker memory,
 * so a restart resumes exactly where it left off (§14).
 *
 * Every executed step writes an `automation_events` row with an idempotency
 * key, so a replayed tick cannot produce a second business effect (§13).
 */

const MAX_STEPS_PER_TICK = 50;

export type AdvanceResult = {
  runId: string;
  state: string;
  steps: number;
  stopped?: string;
};

/** Resolve a wait config to milliseconds. */
export function resolveWaitMs(config: WaitConfig): number {
  const days = config.days ?? 0;
  const hours = config.hours ?? 0;
  return (days * 24 + hours) * 60 * 60 * 1000;
}

/** Global emergency control (BR-39, doc 07 §11). */
export async function isPausedAll(): Promise<boolean> {
  return (await getSetting("automation.pause_all")) === true;
}

type StepRow = {
  stepKey: string;
  stepType: string;
  config: unknown;
  nextStepKey: string | null;
  branchMap: unknown;
  sortOrder: number;
};

async function loadSteps(automationId: string, version: number) {
  const rows = await prisma.automationStep.findMany({
    where: { automationId, version },
    orderBy: { sortOrder: "asc" },
    select: {
      stepKey: true,
      stepType: true,
      config: true,
      nextStepKey: true,
      branchMap: true,
      sortOrder: true,
    },
  });
  return new Map<string, StepRow>(rows.map((r) => [r.stepKey, r as StepRow]));
}

async function recordEvent(input: {
  runId: string;
  stepKey: string | null;
  eventType: string;
  payload?: Prisma.InputJsonValue;
  idempotencyKey?: string;
}): Promise<boolean> {
  try {
    await prisma.automationEvent.create({
      data: {
        runId: input.runId,
        stepKey: input.stepKey,
        eventType: input.eventType,
        ...(input.payload !== undefined && { payload: input.payload }),
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    return true;
  } catch {
    // Unique violation on idempotencyKey — this effect already happened.
    return false;
  }
}

/**
 * Advance a run until it parks, completes or stops.
 * Safe to call repeatedly; already-executed steps are skipped by their key.
 */
export async function advanceRun(runId: string): Promise<AdvanceResult> {
  const run = await prisma.automationRun.findUnique({
    where: { id: runId },
    include: {
      automation: { select: { id: true, name: true, status: true } },
      customer: { select: { id: true, name: true, optedOutAt: true } },
    },
  });
  if (!run) return { runId, state: "MISSING", steps: 0 };

  if (run.state === "COMPLETED" || run.state === "STOPPED") {
    return { runId, state: run.state, steps: 0 };
  }
  if (run.state === "PAUSED" || (await isPausedAll())) {
    return { runId, state: "PAUSED", steps: 0 };
  }
  if (run.automation.status === "PAUSED" || run.automation.status === "DISABLED") {
    return { runId, state: run.state, steps: 0 };
  }

  // Respect exit paths — an opted-out customer never receives another step.
  if (run.customer.optedOutAt) {
    await stopRun(runId, "customer opted out");
    return { runId, state: "STOPPED", steps: 0, stopped: "customer opted out" };
  }

  const steps = await loadSteps(run.automationId, run.automationVersion);
  let currentKey: string | null =
    run.currentStepKey ?? [...steps.values()][0]?.stepKey ?? null;
  let executed = 0;

  while (currentKey && executed < MAX_STEPS_PER_TICK) {
    const step = steps.get(currentKey);
    if (!step) {
      await failRun(runId, currentKey, `Unknown step "${currentKey}"`);
      return { runId, state: "FAILED", steps: executed };
    }

    executed++;

    if (step.stepType === "TRIGGER") {
      currentKey = step.nextStepKey;
      continue;
    }

    if (step.stepType === "WAIT") {
      const parsed = waitConfig.safeParse(step.config);
      if (!parsed.success) {
        await failRun(runId, step.stepKey, "Invalid wait configuration");
        return { runId, state: "FAILED", steps: executed };
      }
      const ms = resolveWaitMs(parsed.data);
      const dueAt = new Date(Date.now() + ms);
      await prisma.automationRun.update({
        where: { id: runId },
        data: {
          state: "WAITING",
          currentStepKey: step.nextStepKey,
          nextActionAt: dueAt,
        },
      });
      await recordEvent({
        runId,
        stepKey: step.stepKey,
        eventType: "wait.started",
        payload: { dueAt: dueAt.toISOString(), ms },
      });
      return { runId, state: "WAITING", steps: executed };
    }

    if (step.stepType === "BRANCH") {
      const parsed = branchConfig.safeParse(step.config);
      if (!parsed.success) {
        await failRun(runId, step.stepKey, "Invalid branch configuration");
        return { runId, state: "FAILED", steps: executed };
      }

      // Ask once per run+step. A replayed tick must not re-ask.
      const asked = await recordEvent({
        runId,
        stepKey: step.stepKey,
        eventType: "question.asked",
        payload: { questionKey: parsed.data.questionKey },
        idempotencyKey: `${runId}:${step.stepKey}:ask`,
      });

      if (!asked) {
        /*
         * The question was already sent and we are back on this step, so the
         * worker woke the run on its timeout — the customer did not answer in
         * the configured window (doc 07 §8).
         *
         * Re-parking here would re-arm the timer forever and the no-response
         * branch would never run, so route to the timeout target instead.
         */
        if (parsed.data.timeoutStepKey) {
          await recordEvent({
            runId,
            stepKey: step.stepKey,
            eventType: "question.timeout",
            payload: { questionKey: parsed.data.questionKey },
            idempotencyKey: `${runId}:${step.stepKey}:timeout`,
          });
          currentKey = parsed.data.timeoutStepKey;
          continue;
        }

        // No timeout configured: wait indefinitely for a reply.
        await prisma.automationRun.update({
          where: { id: runId },
          data: {
            state: "WAITING",
            currentStepKey: step.stepKey,
            nextActionAt: null,
          },
        });
        return { runId, state: "WAITING", steps: executed };
      }

      const result = await sendToCustomer({
        customerId: run.customerId,
        body: parsed.data.templateId ? undefined : parsed.data.prompt,
        templateId: parsed.data.templateId,
      });
      if (!result.ok) {
        await recordEvent({
          runId,
          stepKey: step.stepKey,
          eventType: "question.send_failed",
          payload: { reason: result.reason },
        });
        await failRun(runId, step.stepKey, result.reason);
        return { runId, state: "FAILED", steps: executed };
      }

      let timeoutAt: Date | null = null;
      if (parsed.data.timeout && parsed.data.timeoutStepKey) {
        timeoutAt = new Date(Date.now() + resolveWaitMs(parsed.data.timeout));
      }

      await prisma.automationRun.update({
        where: { id: runId },
        data: {
          state: "WAITING",
          currentStepKey: step.stepKey, // park ON the question
          nextActionAt: timeoutAt,
        },
      });
      return { runId, state: "WAITING", steps: executed };
    }

    if (step.stepType === "CONDITION") {
      const parsed = conditionConfig.safeParse(step.config);
      if (!parsed.success) {
        await failRun(runId, step.stepKey, "Invalid condition configuration");
        return { runId, state: "FAILED", steps: executed };
      }
      const met = await evaluateCondition(run.customerId, parsed.data);
      await recordEvent({
        runId,
        stepKey: step.stepKey,
        eventType: "condition.evaluated",
        payload: { condition: parsed.data.condition, met },
      });
      currentKey =
        (met ? parsed.data.thenStepKey : parsed.data.elseStepKey) ??
        step.nextStepKey;
      continue;
    }

    if (step.stepType === "ACTION") {
      const parsed = actionConfig.safeParse(step.config);
      if (!parsed.success) {
        await failRun(runId, step.stepKey, "Invalid action configuration");
        return { runId, state: "FAILED", steps: executed };
      }

      const fresh = await recordEvent({
        runId,
        stepKey: step.stepKey,
        eventType: "action.executed",
        payload: { action: parsed.data.action },
        idempotencyKey: `${runId}:${step.stepKey}:do`,
      });

      if (fresh) {
        const outcome = await executeAction(run.customerId, parsed.data, runId);
        if (outcome === "stopped") {
          return { runId, state: "STOPPED", steps: executed };
        }
        if (outcome === "failed") {
          await failRun(runId, step.stepKey, "Action failed");
          return { runId, state: "FAILED", steps: executed };
        }
      }

      currentKey = step.nextStepKey;
      continue;
    }

    await failRun(runId, step.stepKey, `Unsupported step type "${step.stepType}"`);
    return { runId, state: "FAILED", steps: executed };
  }

  if (!currentKey) {
    await prisma.automationRun.update({
      where: { id: runId },
      data: {
        state: "COMPLETED",
        completedAt: new Date(),
        currentStepKey: null,
        nextActionAt: null,
      },
    });
    await recordEvent({ runId, stepKey: null, eventType: "run.completed" });
    return { runId, state: "COMPLETED", steps: executed };
  }

  // Hit the per-tick budget — leave it runnable rather than looping forever.
  await prisma.automationRun.update({
    where: { id: runId },
    data: { state: "WAITING", currentStepKey: currentKey, nextActionAt: new Date() },
  });
  return { runId, state: "WAITING", steps: executed };
}

/**
 * A customer answered. Records the response and jumps the run to the mapped
 * branch. Called from webhook ingestion (doc 07 §13: replies cancel pending
 * waits and branch to the appropriate journey).
 */
export async function applyCustomerResponse(input: {
  customerId: string;
  text: string;
  replyId?: string | null;
  messageId?: string | null;
}): Promise<string[]> {
  const runs = await prisma.automationRun.findMany({
    where: { customerId: input.customerId, state: "WAITING" },
    orderBy: { enteredAt: "desc" },
    include: { automation: { select: { status: true } } },
  });

  const advanced: string[] = [];

  for (const run of runs) {
    if (!run.currentStepKey) continue;
    if (run.automation.status !== "ACTIVE") continue;

    const step = await prisma.automationStep.findUnique({
      where: {
        automationId_version_stepKey: {
          automationId: run.automationId,
          version: run.automationVersion,
          stepKey: run.currentStepKey,
        },
      },
      select: { stepType: true, config: true },
    });
    if (!step || step.stepType !== "BRANCH") continue;

    const parsed = branchConfig.safeParse(step.config);
    if (!parsed.success) continue;

    const answer = normaliseAnswer(input.text, input.replyId);
    const nextStepKey = parsed.data.answers[answer] ?? parsed.data.otherStepKey;

    await prisma.customerResponse.create({
      data: {
        customerId: input.customerId,
        runId: run.id,
        questionKey: parsed.data.questionKey,
        questionText: parsed.data.prompt,
        response: input.text.slice(0, 500),
        result: nextStepKey ? `→ ${nextStepKey}` : "unmapped — needs a human",
        messageId: input.messageId ?? null,
      },
    });

    await recordEvent({
      runId: run.id,
      stepKey: run.currentStepKey,
      eventType: "question.answered",
      payload: { questionKey: parsed.data.questionKey, answer, nextStepKey },
      // One answer per question per run — a duplicate webhook cannot re-branch.
      idempotencyKey: `${run.id}:${run.currentStepKey}:answer`,
    });

    if (!nextStepKey) {
      // GAP-017: free-text interpretation is undecided. Stop rather than guess,
      // and leave the conversation with staff.
      await stopRun(run.id, "unrecognised reply — handed to staff");
      continue;
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: { state: "RUNNING", currentStepKey: nextStepKey, nextActionAt: null },
    });

    await advanceRun(run.id);
    advanced.push(run.id);
  }

  return advanced;
}

async function evaluateCondition(
  customerId: string,
  config: { condition: string; value?: string },
): Promise<boolean> {
  switch (config.condition) {
    case "customer_answered_yes":
    case "customer_answered_no": {
      const wanted = config.condition === "customer_answered_yes" ? "YES" : "NO";
      const response = await prisma.customerResponse.findFirst({
        where: { customerId, ...(config.value && { questionKey: config.value }) },
        orderBy: { receivedAt: "desc" },
        select: { response: true },
      });
      return normaliseAnswer(response?.response ?? "") === wanted;
    }
    case "customer_replied":
      return (
        (await prisma.message.count({
          where: { customerId, direction: "INBOUND" },
        })) > 0
      );
    case "customer_did_not_respond":
      return (
        (await prisma.message.count({
          where: { customerId, direction: "INBOUND" },
        })) === 0
      );
    default:
      return false;
  }
}

async function executeAction(
  customerId: string,
  config: import("@/lib/automation/types").ActionConfig,
  runId: string,
): Promise<"ok" | "stopped" | "failed"> {
  switch (config.action) {
    case "send_message": {
      const result = await sendToCustomer({
        customerId,
        body: config.body,
        templateId: config.templateId,
      });
      return result.ok ? "ok" : "failed";
    }

    case "mark_qualified": {
      // The system's output event. Deliberately its own action rather than a
      // general status change, so it is unmistakable in the audit log.
      const customer = await prisma.customer.update({
        where: { id: customerId },
        data: { status: "QUALIFIED", qualifiedAt: new Date() },
        select: { name: true, phoneE164: true },
      });
      await logActivity({
        eventType: "customer.qualified",
        objectType: "customer",
        objectId: customerId,
        customerId,
        metadata: { by: "automation", runId },
      });
      // Nobody is assigned anything here, so everyone who can act on a
      // qualified number is told about it.
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          eventType: "customer.qualified",
          title: `${customer.name ?? customer.phoneE164} asked to be contacted`,
          relatedType: "customer",
          relatedId: customerId,
        });
      }
      return "ok";
    }

    case "set_status": {
      await prisma.customer.update({
        where: { id: customerId },
        data: { status: config.status },
      });
      await logActivity({
        eventType: "customer.status_changed",
        objectType: "customer",
        objectId: customerId,
        customerId,
        after: { status: config.status },
        metadata: { by: "automation", runId },
      });
      return "ok";
    }

    case "add_note":
      await logActivity({
        eventType: "customer.note_added",
        objectType: "customer",
        objectId: customerId,
        customerId,
        metadata: { note: config.note, by: "automation", runId },
      });
      return "ok";

    case "stop_journey":
      // The run ending is not the same as the number being answered for. A
      // stop without a status leaves it reading "In funnel" forever.
      if (config.status) {
        await prisma.customer.update({
          where: { id: customerId },
          data: { status: config.status },
        });
        await logActivity({
          eventType: "customer.status_changed",
          objectType: "customer",
          objectId: customerId,
          customerId,
          after: { status: config.status },
          metadata: { by: "automation", runId, reason: config.reason },
        });
      }
      await stopRun(runId, config.reason);
      return "stopped";
  }
}

export async function stopRun(runId: string, reason: string) {
  await prisma.automationRun.update({
    where: { id: runId },
    data: {
      state: "STOPPED",
      stoppedAt: new Date(),
      stopReason: reason,
      nextActionAt: null,
    },
  });
  await recordEvent({
    runId,
    stepKey: null,
    eventType: "run.stopped",
    payload: { reason },
  });
}

async function failRun(runId: string, stepKey: string | null, reason: string) {
  await prisma.automationRun.update({
    where: { id: runId },
    data: { state: "FAILED", nextActionAt: null, stopReason: reason },
  });
  await recordEvent({
    runId,
    stepKey,
    eventType: "run.failed",
    payload: { reason },
  });
}
