"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { customerScope } from "@/lib/rbac";
import { assertPermission } from "@/lib/session";

/**
 * Phone normalisation per Security §9. The source does not define a default
 * country, so a bare national number is rejected rather than guessed
 * (GAP-004 duplicate policy is also still open — uniqueness is on E.164 only).
 */
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+[1-9]\d{7,14}$/.test(v), {
    message: "Enter the phone in international format, e.g. +919876543210",
  });

const customerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  phoneE164: phone,
  email: z.union([z.email(), z.literal("")]).optional(),
  location: z.string().trim().max(160).optional(),
  sourceId: z.uuid("Select a source"),
  sourceDetail: z.string().trim().max(240).optional(),
  requirements: z.string().trim().max(4000).optional(),
});

export type ActionState = { error?: string; fieldErrors?: Record<string, string> };

export async function createCustomer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await assertPermission("customer:create");

  const parsed = customerInput.safeParse({
    name: formData.get("name"),
    phoneE164: formData.get("phoneE164"),
    email: formData.get("email") ?? "",
    location: formData.get("location") ?? "",
    sourceId: formData.get("sourceId"),
    sourceDetail: formData.get("sourceDetail") ?? "",
    requirements: formData.get("requirements") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  const existing = await prisma.customer.findUnique({
    where: { phoneE164: data.phoneE164 },
    select: { id: true },
  });
  if (existing) {
    return {
      error: "A customer with this phone number already exists.",
      fieldErrors: { phoneE164: "Already in the database" },
    };
  }

  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      phoneE164: data.phoneE164,
      email: data.email || null,
      location: data.location || null,
      sourceId: data.sourceId,
      sourceDetail: data.sourceDetail || null,
      requirements: data.requirements ? { note: data.requirements } : undefined,
    },
    select: { id: true, name: true },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "customer.created",
    objectType: "customer",
    objectId: customer.id,
    customerId: customer.id,
    metadata: { name: customer.name },
  });

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

/** Assignment + reassignment (F-017, BR-29). Both are audited (§10). */
export async function assignCustomer(formData: FormData) {
  const user = await assertPermission("customer:assign");

  const customerId = z.uuid().parse(formData.get("customerId"));
  const raw = String(formData.get("staffId") ?? "");
  const staffId = raw === "" ? null : z.uuid().parse(raw);
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const before = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { assignedStaffId: true },
  });
  if (!before) return;
  if (before.assignedStaffId === staffId) return;

  await prisma.$transaction(async (tx) => {
    if (before.assignedStaffId) {
      await tx.staffAssignment.updateMany({
        where: { customerId, staffId: before.assignedStaffId, endedAt: null },
        data: { endedAt: new Date() },
      });
    }
    await tx.customer.update({
      where: { id: customerId },
      data: { assignedStaffId: staffId },
    });
    await tx.lead.updateMany({
      where: { customerId },
      data: { assignedStaffId: staffId },
    });
    if (staffId) {
      await tx.staffAssignment.create({
        data: { customerId, staffId, assignedById: user.id, reason },
      });
    }
  });

  await logActivity({
    actorUserId: user.id,
    eventType: before.assignedStaffId ? "customer.reassigned" : "customer.assigned",
    objectType: "customer",
    objectId: customerId,
    customerId,
    before: { assignedStaffId: before.assignedStaffId },
    after: { assignedStaffId: staffId },
    metadata: reason ? { reason } : undefined,
  });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

/** Interest status (F-013, BR-25) — tracked separately from lead stage. */
export async function updateInterestStatus(formData: FormData) {
  const user = await assertPermission("customer:update");

  const customerId = z.uuid().parse(formData.get("customerId"));
  const interestStatus = z
    .enum([
      "NOT_YET_CONTACTED",
      "INTERESTED",
      "VERY_INTERESTED",
      "NOT_INTERESTED",
      "REVISIT_LATER",
      "CALL_REQUIRED",
      "MEETING_REQUIRED",
      "CONVERTED",
      "CLOSED",
    ])
    .parse(formData.get("interestStatus"));

  // Staff may only act on their own book (Security §3).
  const scope = customerScope(user.roles, user.id);
  const target = await prisma.customer.findFirst({
    where: { id: customerId, ...scope },
    select: { interestStatus: true },
  });
  if (!target) return;
  if (target.interestStatus === interestStatus) return;

  await prisma.$transaction([
    prisma.customer.update({ where: { id: customerId }, data: { interestStatus } }),
    prisma.lead.updateMany({ where: { customerId }, data: { interestStatus } }),
  ]);

  await logActivity({
    actorUserId: user.id,
    eventType: "customer.interest_status_changed",
    objectType: "customer",
    objectId: customerId,
    customerId,
    before: { interestStatus: target.interestStatus },
    after: { interestStatus },
  });

  revalidatePath(`/customers/${customerId}`);
}
