"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { customerScope } from "@/lib/rbac";
import { assertPermission } from "@/lib/session";

/**
 * Lead stage change (F-012, BR-24).
 *
 * GAP-003 — allowed stage transitions are an open business decision. Until it
 * is resolved, any stage-to-stage move is permitted and every move is written
 * to `lead_stage_history`, so the transition rule can be enforced later
 * against a complete record rather than an invented one now.
 */
export async function moveLeadStage(formData: FormData) {
  const user = await assertPermission("lead:update");

  const leadId = z.uuid().parse(formData.get("leadId"));
  const toStageId = z.uuid().parse(formData.get("stageId"));
  const note = String(formData.get("note") ?? "").trim() || null;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, customer: customerScope(user.roles, user.id) },
    select: { id: true, stageId: true, customerId: true },
  });
  if (!lead || lead.stageId === toStageId) return;

  const toStage = await prisma.leadStage.findUnique({
    where: { id: toStageId },
    select: { id: true, code: true, name: true },
  });
  if (!toStage) return;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { stageId: toStageId } });
    await tx.leadStageHistory.create({
      data: {
        leadId,
        fromStageId: lead.stageId,
        toStageId,
        changedById: user.id,
        note,
      },
    });

    // Converted is a stage the source defines; the *criteria* for conversion
    // are GAP-009, so reaching the stage records the fact and nothing more.
    if (toStage.code === "CONVERTED") {
      await tx.customer.update({
        where: { id: lead.customerId },
        data: { interestStatus: "CONVERTED" },
      });
    }
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "lead.stage_changed",
    objectType: "lead",
    objectId: leadId,
    customerId: lead.customerId,
    before: { stageId: lead.stageId },
    after: { stageId: toStageId, stage: toStage.code },
    metadata: note ? { note } : undefined,
  });

  revalidatePath("/leads");
  revalidatePath(`/customers/${lead.customerId}`);
}

/** Create the lead record for a customer that does not have one yet. */
export async function createLead(formData: FormData) {
  const user = await assertPermission("lead:update");
  const customerId = z.uuid().parse(formData.get("customerId"));

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...customerScope(user.roles, user.id) },
    select: { id: true, interestStatus: true, assignedStaffId: true, lead: { select: { id: true } } },
  });
  if (!customer || customer.lead) return;

  const firstStage = await prisma.leadStage.findFirstOrThrow({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  const lead = await prisma.lead.create({
    data: {
      customerId,
      stageId: firstStage.id,
      interestStatus: customer.interestStatus,
      assignedStaffId: customer.assignedStaffId,
    },
  });
  await prisma.leadStageHistory.create({
    data: { leadId: lead.id, toStageId: firstStage.id, changedById: user.id },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "lead.created",
    objectType: "lead",
    objectId: lead.id,
    customerId,
  });

  revalidatePath("/leads");
  revalidatePath(`/customers/${customerId}`);
}
