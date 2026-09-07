"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";
import { validateAutomation } from "@/lib/automation/validate";
import {
  toEngineSteps,
  validateBuilderSteps,
  type BuilderStep,
} from "@/lib/funnels/steps";

export type FunnelState = { error?: string; problems?: string[]; saved?: boolean };

const builderStep: z.ZodType<BuilderStep> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), key: z.string().min(1), templateId: z.string() }),
  z.object({
    kind: z.literal("wait"),
    key: z.string().min(1),
    days: z.number().int().min(0).max(365),
    hours: z.number().int().min(0).max(23),
  }),
  z.object({ kind: z.literal("qualify"), key: z.string().min(1) }),
  z.object({ kind: z.literal("stop"), key: z.string().min(1), reason: z.string().max(200) }),
  z.object({
    kind: z.literal("question"),
    key: z.string().min(1),
    templateId: z.string(),
    prompt: z.string().max(4000),
    questionKey: z.string().min(1).max(60),
    yesKey: z.string().nullable(),
    noKey: z.string().nullable(),
    otherKey: z.string().nullable(),
  }),
]) as z.ZodType<BuilderStep>;

export async function createFunnel(formData: FormData) {
  const user = await assertPermission("funnel:manage");
  const name = String(formData.get("name") ?? "").trim() || "Untitled funnel";

  const funnel = await prisma.automation.create({
    data: { name, type: "CUSTOM", status: "DRAFT", version: 1, createdById: user.id },
    select: { id: true },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.created",
    objectType: "automation",
    objectId: funnel.id,
    after: { name },
  });

  redirect(`/funnels/${funnel.id}`);
}

/**
 * Save the step list.
 *
 * Editing a DRAFT edits in place. Editing an ACTIVE funnel creates a new
 * version, because runs already in flight pin their own version and must not
 * have the ground shift under them mid-journey.
 */
export async function saveFunnel(
  _prev: FunnelState,
  formData: FormData,
): Promise<FunnelState> {
  const user = await assertPermission("funnel:manage");

  const id = z.uuid().parse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the funnel a name." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    return { error: "The funnel could not be read." };
  }

  const parsed = z.array(builderStep).safeParse(raw);
  if (!parsed.success) return { error: "The funnel could not be read." };

  const problems = validateBuilderSteps(parsed.data);
  if (problems.length > 0) return { problems };

  const funnel = await prisma.automation.findUnique({
    where: { id },
    select: { id: true, status: true, version: true },
  });
  if (!funnel) return { error: "Funnel not found." };

  const version = funnel.status === "ACTIVE" ? funnel.version + 1 : funnel.version;
  const rows = toEngineSteps(parsed.data);

  await prisma.$transaction(async (tx) => {
    if (version === funnel.version) {
      await tx.automationStep.deleteMany({ where: { automationId: id, version } });
    }
    await tx.automationStep.createMany({
      data: rows.map((r) => ({
        automationId: id,
        version,
        stepKey: r.stepKey,
        stepType: r.stepType,
        config: r.config as never,
        nextStepKey: r.nextStepKey,
        sortOrder: r.sortOrder,
      })),
    });
    await tx.automation.update({ where: { id }, data: { name, version } });
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.saved",
    objectType: "automation",
    objectId: id,
    after: { name, version, steps: rows.length },
  });

  revalidatePath(`/funnels/${id}`);
  revalidatePath("/funnels");
  return { saved: true };
}

export async function activateFunnel(
  _prev: FunnelState,
  formData: FormData,
): Promise<FunnelState> {
  const user = await assertPermission("funnel:manage");
  const id = z.uuid().parse(formData.get("id"));

  const problems = await validateAutomation(id);
  if (problems.length > 0) return { problems };

  await prisma.automation.update({
    where: { id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "funnel.activated",
    objectType: "automation",
    objectId: id,
  });

  revalidatePath(`/funnels/${id}`);
  revalidatePath("/funnels");
  return { saved: true };
}

/**
 * Pause / resume one funnel.
 *
 * GAP-016 — timers are preserved rather than recalculated, so a run that came
 * due during a pause fires on resume instead of silently skipping its wait.
 */
export async function setFunnelStatus(formData: FormData) {
  const user = await assertPermission("funnel:manage");
  const id = z.uuid().parse(formData.get("id"));
  const status = z.enum(["ACTIVE", "PAUSED", "DISABLED", "DRAFT"]).parse(
    formData.get("status"),
  );

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
    eventType: `funnel.${status.toLowerCase()}`,
    objectType: "automation",
    objectId: id,
    before: { status: before.status },
    after: { status },
  });

  revalidatePath("/funnels");
  revalidatePath(`/funnels/${id}`);
}

/** Duplicate a funnel as a new Draft, so a live one can be edited safely. */
export async function duplicateFunnel(formData: FormData) {
  const user = await assertPermission("funnel:manage");
  const id = z.uuid().parse(formData.get("id"));

  const source = await prisma.automation.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
  const steps = source.steps.filter((s) => s.version === source.version);

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
        create: steps.map((s) => ({
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
    eventType: "funnel.duplicated",
    objectType: "automation",
    objectId: copy.id,
    metadata: { sourceId: id },
  });

  revalidatePath("/funnels");
}
