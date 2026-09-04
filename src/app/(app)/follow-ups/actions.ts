"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { customerScope } from "@/lib/rbac";
import { assertPermission } from "@/lib/session";

export type FollowUpState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

const createInput = z.object({
  customerId: z.uuid("Select a customer"),
  assignedStaffId: z.uuid("Select an owner"),
  type: z.string().trim().min(1, "Type is required").max(60),
  dueAt: z.coerce.date({ error: "Enter a valid due date and time" }),
  notes: z.string().trim().max(2000).optional(),
});

/** Create a follow-up (F-014, BR-26). */
export async function createFollowUp(
  _prev: FollowUpState,
  formData: FormData,
): Promise<FollowUpState> {
  const user = await assertPermission("followup:manage");

  const parsed = createInput.safeParse({
    customerId: formData.get("customerId"),
    assignedStaffId: formData.get("assignedStaffId"),
    type: formData.get("type"),
    dueAt: formData.get("dueAt"),
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, ...customerScope(user.roles, user.id) },
    select: { id: true, nextFollowUpAt: true, lead: { select: { id: true } } },
  });
  if (!customer) return { error: "You cannot create a follow-up for that customer." };

  const followUp = await prisma.followUp.create({
    data: {
      customerId: data.customerId,
      leadId: customer.lead?.id,
      assignedStaffId: data.assignedStaffId,
      type: data.type,
      dueAt: data.dueAt,
      notes: data.notes || null,
      createdById: user.id,
    },
    select: { id: true },
  });

  await syncNextFollowUp(data.customerId);

  await logActivity({
    actorUserId: user.id,
    eventType: "followup.created",
    objectType: "follow_up",
    objectId: followUp.id,
    customerId: data.customerId,
    after: { type: data.type, dueAt: data.dueAt.toISOString() },
  });

  revalidatePath("/follow-ups");
  revalidatePath(`/customers/${data.customerId}`);
  return { saved: true };
}

/** Complete a follow-up (F-014). */
export async function completeFollowUp(formData: FormData) {
  const user = await assertPermission("followup:manage");
  const id = z.uuid().parse(formData.get("id"));
  const notes = String(formData.get("notes") ?? "").trim() || undefined;

  const followUp = await prisma.followUp.findFirst({
    where: { id, customer: customerScope(user.roles, user.id) },
    select: { id: true, status: true, customerId: true },
  });
  if (!followUp || followUp.status !== "PENDING") return;

  await prisma.followUp.update({
    where: { id },
    data: { status: "COMPLETED", completedAt: new Date(), ...(notes && { notes }) },
  });

  await syncNextFollowUp(followUp.customerId);

  await logActivity({
    actorUserId: user.id,
    eventType: "followup.completed",
    objectType: "follow_up",
    objectId: id,
    customerId: followUp.customerId,
  });

  revalidatePath("/follow-ups");
  revalidatePath(`/customers/${followUp.customerId}`);
}

/**
 * Reschedule (F-014). The original row is closed as RESCHEDULED and a new one
 * is created pointing back at it, so the history of a slipped commitment is
 * preserved rather than overwritten.
 */
export async function rescheduleFollowUp(formData: FormData) {
  const user = await assertPermission("followup:manage");
  const id = z.uuid().parse(formData.get("id"));
  const dueAt = z.coerce.date().parse(formData.get("dueAt"));

  const original = await prisma.followUp.findFirst({
    where: { id, customer: customerScope(user.roles, user.id) },
  });
  if (!original || original.status !== "PENDING") return;

  await prisma.$transaction([
    prisma.followUp.update({
      where: { id },
      data: { status: "RESCHEDULED", completedAt: new Date() },
    }),
    prisma.followUp.create({
      data: {
        customerId: original.customerId,
        leadId: original.leadId,
        assignedStaffId: original.assignedStaffId,
        type: original.type,
        dueAt,
        notes: original.notes,
        rescheduledFromId: original.id,
        createdById: user.id,
      },
    }),
  ]);

  await syncNextFollowUp(original.customerId);

  await logActivity({
    actorUserId: user.id,
    eventType: "followup.rescheduled",
    objectType: "follow_up",
    objectId: id,
    customerId: original.customerId,
    before: { dueAt: original.dueAt.toISOString() },
    after: { dueAt: dueAt.toISOString() },
  });

  revalidatePath("/follow-ups");
  revalidatePath(`/customers/${original.customerId}`);
}

/** Keep `customers.next_follow_up_at` equal to the earliest pending due date. */
async function syncNextFollowUp(customerId: string) {
  const next = await prisma.followUp.findFirst({
    where: { customerId, status: "PENDING" },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await prisma.customer.update({
    where: { id: customerId },
    data: { nextFollowUpAt: next?.dueAt ?? null },
  });
}

/** Call request status (F-015, BR-27). */
export async function updateCallStatus(formData: FormData) {
  const user = await assertPermission("call:manage");
  const id = z.uuid().parse(formData.get("id"));
  const status = z
    .enum(["NEW", "ASSIGNED", "CONTACTED", "COMPLETED", "RESCHEDULED", "CLOSED"])
    .parse(formData.get("status"));

  const call = await prisma.call.findFirst({
    where: { id, customer: customerScope(user.roles, user.id) },
    select: { id: true, status: true, customerId: true },
  });
  if (!call || call.status === status) return;

  await prisma.call.update({
    where: { id },
    data: {
      status,
      ...(status === "COMPLETED" && { completedAt: new Date() }),
    },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "call.status_changed",
    objectType: "call",
    objectId: id,
    customerId: call.customerId,
    before: { status: call.status },
    after: { status },
  });

  revalidatePath("/follow-ups");
}
