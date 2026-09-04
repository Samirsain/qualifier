"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { stopRun } from "@/lib/automation/engine";
import { enrolCustomer } from "@/lib/automation/entry";
import { validateAutomation } from "@/lib/automation/validate";
import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { assertPermission } from "@/lib/session";

export type ControlState = { error?: string; ok?: string };

/**
 * Activate (doc 07 §16): validate structure before the definition can start
 * new runs. An automation with a missing branch target, an unresolvable wait
 * or an unavailable template cannot be activated.
 */
export async function activateAutomation(
  _prev: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const user = await assertPermission("automation:activate");
  const id = z.uuid().parse(formData.get("id"));

  const problems = await validateAutomation(id);
  if (problems.length > 0) {
    return { error: `Cannot activate: ${problems.join("; ")}` };
  }

  await prisma.automation.update({
    where: { id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "automation.activated",
    objectType: "automation",
    objectId: id,
  });

  revalidatePath("/automations");
  revalidatePath(`/automations/${id}`);
  return { ok: "Automation is active." };
}

/**
 * Pause / resume / disable (doc 07 §11).
 *
 * GAP-016 — timer semantics during pause are undecided. The implemented
 * behaviour is the non-destructive one: timers are *preserved*, not
 * recalculated. A run that was due during a pause becomes due immediately on
 * resume rather than silently skipping or restarting its wait.
 */
export async function setAutomationStatus(formData: FormData) {
  const status = z.enum(["ACTIVE", "PAUSED", "DISABLED", "DRAFT"]).parse(
    formData.get("status"),
  );
  const user = await assertPermission(
    status === "ACTIVE" ? "automation:activate" : "automation:pause",
  );
  const id = z.uuid().parse(formData.get("id"));

  const before = await prisma.automation.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!before || before.status === status) return;

  if (status === "ACTIVE") {
    const problems = await validateAutomation(id);
    if (problems.length > 0) return;
  }

  await prisma.automation.update({
    where: { id },
    data: { status, ...(status === "ACTIVE" && { activatedAt: new Date() }) },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: `automation.${status.toLowerCase()}`,
    objectType: "automation",
    objectId: id,
    before: { status: before.status },
    after: { status },
  });

  revalidatePath("/automations");
  revalidatePath(`/automations/${id}`);
}

/** Emergency pause-all (BR-39, Admin only). Both directions are audited. */
export async function setPauseAll(formData: FormData) {
  const user = await assertPermission("automation:pause_all");
  const paused = formData.get("paused") === "true";

  await setSetting("automation.pause_all", paused, user.id);

  await logActivity({
    actorUserId: user.id,
    eventType: paused ? "automation.pause_all" : "automation.resume_all",
    objectType: "system_setting",
    objectId: "automation.pause_all",
    after: { paused },
  });

  revalidatePath("/automations");
  revalidatePath("/settings");
}

/** Stop one customer's journey (doc 07 §12). Actor and reason are recorded. */
export async function stopCustomerRun(formData: FormData) {
  const user = await assertPermission("automation:pause");
  const runId = z.uuid().parse(formData.get("runId"));
  const reason = String(formData.get("reason") ?? "").trim() || "stopped by staff";

  const run = await prisma.automationRun.findUnique({
    where: { id: runId },
    select: { id: true, state: true, customerId: true, automationId: true },
  });
  if (!run || run.state === "STOPPED" || run.state === "COMPLETED") return;

  await stopRun(runId, reason);

  await logActivity({
    actorUserId: user.id,
    eventType: "automation.run_stopped",
    objectType: "automation_run",
    objectId: runId,
    customerId: run.customerId,
    metadata: { reason },
  });

  revalidatePath(`/automations/${run.automationId}`);
  revalidatePath(`/customers/${run.customerId}`);
}

/** Manually enrol a customer into a journey. */
export async function enrol(
  _prev: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const user = await assertPermission("automation:update");
  const automationId = z.uuid().parse(formData.get("automationId"));
  const customerId = z.uuid().parse(formData.get("customerId"));

  const result = await enrolCustomer({ automationId, customerId });
  if (!result.ok) return { error: result.reason };

  await logActivity({
    actorUserId: user.id,
    eventType: "automation.customer_enrolled",
    objectType: "automation_run",
    objectId: result.runId,
    customerId,
    metadata: { automationId },
  });

  revalidatePath(`/automations/${automationId}`);
  return { ok: "Customer entered the journey." };
}

/** Duplicate a journey as a new Draft (BR-15). */
export async function duplicateAutomation(formData: FormData) {
  const user = await assertPermission("automation:create");
  const id = z.uuid().parse(formData.get("id"));

  const source = await prisma.automation.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });

  const copy = await prisma.automation.create({
    data: {
      name: `${source.name} (copy)`,
      type: source.type,
      status: "DRAFT",
      version: 1,
      description: source.description,
      entryConditions: source.entryConditions ?? undefined,
      createdById: user.id,
      steps: {
        create: source.steps.map((s) => ({
          version: 1,
          stepKey: s.stepKey,
          stepType: s.stepType,
          config: s.config as never,
          nextStepKey: s.nextStepKey,
          branchMap: s.branchMap ?? undefined,
          sortOrder: s.sortOrder,
        })),
      },
    },
    select: { id: true },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "automation.duplicated",
    objectType: "automation",
    objectId: copy.id,
    metadata: { sourceId: id },
  });

  revalidatePath("/automations");
}
