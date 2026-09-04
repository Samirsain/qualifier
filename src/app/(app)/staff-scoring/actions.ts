"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";
import {
  blankConfig,
  parseConfig,
  readyForActivation,
  scoringConfig,
  type FactorConfig,
} from "@/lib/scoring/config";
import { FACTOR_KEYS, type FactorKey } from "@/lib/scoring/factors";

export type ConfigState = {
  error?: string;
  problems?: string[];
  saved?: boolean;
};

/**
 * Save a scoring configuration.
 *
 * Always saved **inactive**. Activation is a separate, explicit action, so a
 * configuration can never become live as a side effect of editing it
 * (doc 13 §4).
 */
export async function saveScoreConfig(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  const user = await assertPermission("staff_score:configure");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the configuration a name." };

  const effectiveFromRaw = String(formData.get("effectiveFrom") ?? "");
  const effectiveFrom = effectiveFromRaw ? new Date(effectiveFromRaw) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    return { error: "Enter a valid effective date." };
  }

  const factors = blankConfig().factors;
  for (const key of FACTOR_KEYS) {
    const weightRaw = String(formData.get(`weight.${key}`) ?? "").trim();
    const capRaw = String(formData.get(`cap.${key}`) ?? "").trim();
    const targetRaw = String(formData.get(`target.${key}`) ?? "").trim();

    const entry: FactorConfig = {
      enabled: formData.get(`enabled.${key}`) === "on",
      weight: weightRaw === "" ? null : Number(weightRaw),
      normalisation:
        (String(formData.get(`normalisation.${key}`) ?? "RAW") as FactorConfig["normalisation"]) ??
        "RAW",
      cap: capRaw === "" ? null : Number(capRaw),
      target: targetRaw === "" ? null : Number(targetRaw),
    };
    if (entry.weight !== null && Number.isNaN(entry.weight)) entry.weight = null;
    if (entry.cap !== null && Number.isNaN(entry.cap)) entry.cap = null;
    if (entry.target !== null && Number.isNaN(entry.target)) entry.target = null;

    factors[key as FactorKey] = entry;
  }

  const parsed = scoringConfig.safeParse({
    factors,
    allowNegativeTotal: formData.get("allowNegativeTotal") === "on",
    minimumSampleSize: Number(formData.get("minimumSampleSize") ?? 0) || 0,
    scoreCeiling:
      String(formData.get("scoreCeiling") ?? "").trim() === ""
        ? null
        : Number(formData.get("scoreCeiling")),
    approvalNote: String(formData.get("approvalNote") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return { error: "Some values are out of range.", problems: parsed.error.issues.map((i) => i.message) };
  }

  const record = id
    ? await prisma.staffScoreConfig.update({
        where: { id },
        data: {
          name,
          effectiveFrom,
          factorConfig: parsed.data as never,
          // Editing never activates, and editing an active config would change
          // history silently — so any edit returns it to inactive.
          active: false,
        },
        select: { id: true },
      })
    : await prisma.staffScoreConfig.create({
        data: {
          name,
          effectiveFrom,
          factorConfig: parsed.data as never,
          active: false,
        },
        select: { id: true },
      });

  await logActivity({
    actorUserId: user.id,
    eventType: id ? "staff_score.config_updated" : "staff_score.config_created",
    objectType: "staff_score_config",
    objectId: record.id,
    after: { name },
  });

  revalidatePath("/staff-scoring");
  return { saved: true, problems: readyForActivation(parsed.data) };
}

/**
 * Activate a configuration. This is the gate doc 13 §4 demands: it refuses
 * unless weights, normalisation, caps and an approval note are all present.
 */
export async function activateScoreConfig(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  const user = await assertPermission("staff_score:configure");
  const id = z.uuid().parse(formData.get("id"));

  const record = await prisma.staffScoreConfig.findUnique({ where: { id } });
  if (!record) return { error: "Configuration not found." };

  const config = parseConfig(record.factorConfig);
  const problems = readyForActivation(config);
  if (problems.length > 0) {
    return {
      error: "This configuration is not ready to activate.",
      problems,
    };
  }

  await prisma.$transaction([
    // Only one configuration is live at a time, so scores stay comparable.
    prisma.staffScoreConfig.updateMany({
      where: { active: true },
      data: { active: false, effectiveTo: new Date() },
    }),
    prisma.staffScoreConfig.update({
      where: { id },
      data: { active: true, approvedById: user.id, effectiveTo: null },
    }),
  ]);

  await logActivity({
    actorUserId: user.id,
    eventType: "staff_score.config_activated",
    objectType: "staff_score_config",
    objectId: id,
    after: { name: record.name, approvedBy: user.id },
  });

  revalidatePath("/staff-scoring");
  revalidatePath("/staff");
  return { saved: true };
}

/** Deactivate, returning the system to "no approved formula". */
export async function deactivateScoreConfig(formData: FormData) {
  const user = await assertPermission("staff_score:configure");
  const id = z.uuid().parse(formData.get("id"));

  await prisma.staffScoreConfig.update({
    where: { id },
    data: { active: false, effectiveTo: new Date() },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "staff_score.config_deactivated",
    objectType: "staff_score_config",
    objectId: id,
  });

  revalidatePath("/staff-scoring");
  revalidatePath("/staff");
}
