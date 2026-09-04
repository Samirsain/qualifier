"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { customerScope } from "@/lib/rbac";
import { createCallRequest, createMeetingRequest } from "@/lib/requests";
import { assertPermission } from "@/lib/session";

export type RequestState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

const requestInput = z.object({
  customerId: z.uuid("Select a customer"),
  requirement: z.string().trim().min(1, "Describe what the customer needs").max(500),
  assignedStaffId: z.union([z.uuid(), z.literal("")]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[String(issue.path[0])] ??= issue.message;
  }
  return fieldErrors;
}

/** Staff-raised call request (F-015). Automations use the same service. */
export async function createCall(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const user = await assertPermission("call:manage");

  const parsed = requestInput.safeParse({
    customerId: formData.get("customerId"),
    requirement: formData.get("requirement"),
    assignedStaffId: formData.get("assignedStaffId") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const permitted = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, ...customerScope(user.roles, user.id) },
    select: { id: true },
  });
  if (!permitted) return { error: "You cannot raise a request for that customer." };

  await createCallRequest({
    customerId: parsed.data.customerId,
    requirement: parsed.data.requirement,
    actorUserId: user.id,
    assignedStaffId: parsed.data.assignedStaffId || null,
    notes: parsed.data.notes || null,
  });

  revalidatePath("/follow-ups");
  revalidatePath(`/customers/${parsed.data.customerId}`);
  return { saved: true };
}

/** Staff-raised meeting request (F-016). */
export async function createMeeting(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const user = await assertPermission("meeting:manage");

  const parsed = requestInput.safeParse({
    customerId: formData.get("customerId"),
    requirement: formData.get("requirement"),
    assignedStaffId: formData.get("assignedStaffId") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const permitted = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, ...customerScope(user.roles, user.id) },
    select: { id: true },
  });
  if (!permitted) return { error: "You cannot raise a request for that customer." };

  const rawSchedule = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = rawSchedule ? new Date(rawSchedule) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return { fieldErrors: { scheduledAt: "Enter a valid date and time" } };
  }

  await createMeetingRequest({
    customerId: parsed.data.customerId,
    requirement: parsed.data.requirement,
    actorUserId: user.id,
    assignedStaffId: parsed.data.assignedStaffId || null,
    scheduledAt,
    notes: parsed.data.notes || null,
  });

  revalidatePath("/follow-ups");
  revalidatePath(`/customers/${parsed.data.customerId}`);
  return { saved: true };
}

/** Reassign a call or meeting to a different owner, with notification. */
export async function assignRequest(formData: FormData) {
  const kind = z.enum(["call", "meeting"]).parse(formData.get("kind"));
  const user = await assertPermission(
    kind === "call" ? "call:manage" : "meeting:manage",
  );

  const id = z.uuid().parse(formData.get("id"));
  const raw = String(formData.get("staffId") ?? "");
  const staffId = raw === "" ? null : z.uuid().parse(raw);

  const scope = customerScope(user.roles, user.id);

  if (kind === "call") {
    const call = await prisma.call.findFirst({
      where: { id, customer: scope },
      select: {
        id: true,
        assignedStaffId: true,
        status: true,
        customerId: true,
        requirement: true,
        customer: { select: { name: true } },
      },
    });
    if (!call || call.assignedStaffId === staffId) return;

    await prisma.call.update({
      where: { id },
      data: {
        assignedStaffId: staffId,
        // Only promote NEW → ASSIGNED; never regress a call already worked on.
        status: staffId && call.status === "NEW" ? "ASSIGNED" : call.status,
      },
    });

    await notify({
      userId: staffId,
      eventType: "call.requested",
      title: `Call assigned to you — ${call.customer.name}`,
      body: call.requirement,
      relatedType: "call",
      relatedId: call.id,
    });

    await logActivity({
      actorUserId: user.id,
      eventType: "call.assigned",
      objectType: "call",
      objectId: id,
      customerId: call.customerId,
      before: { assignedStaffId: call.assignedStaffId },
      after: { assignedStaffId: staffId },
    });
  } else {
    const meeting = await prisma.meeting.findFirst({
      where: { id, customer: scope },
      select: {
        id: true,
        assignedStaffId: true,
        customerId: true,
        requirement: true,
        customer: { select: { name: true } },
      },
    });
    if (!meeting || meeting.assignedStaffId === staffId) return;

    await prisma.meeting.update({
      where: { id },
      data: { assignedStaffId: staffId },
    });

    await notify({
      userId: staffId,
      eventType: "meeting.requested",
      title: `Meeting assigned to you — ${meeting.customer.name}`,
      body: meeting.requirement,
      relatedType: "meeting",
      relatedId: meeting.id,
    });

    await logActivity({
      actorUserId: user.id,
      eventType: "meeting.assigned",
      objectType: "meeting",
      objectId: id,
      customerId: meeting.customerId,
      before: { assignedStaffId: meeting.assignedStaffId },
      after: { assignedStaffId: staffId },
    });
  }

  revalidatePath("/follow-ups");
}

/**
 * Meeting status and outcome (F-016).
 *
 * GAP-007 and GAP-008 leave both taxonomies undefined, so the values are
 * stored as entered and are not validated against an invented list. The field
 * is free text on purpose until the business approves values.
 */
export async function updateMeeting(formData: FormData) {
  const user = await assertPermission("meeting:manage");

  const id = z.uuid().parse(formData.get("id"));
  const meetingStatus = String(formData.get("meetingStatus") ?? "").trim().slice(0, 60);
  const outcome = String(formData.get("outcome") ?? "").trim().slice(0, 200) || null;
  const rawSchedule = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = rawSchedule ? new Date(rawSchedule) : undefined;

  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return;
  if (!meetingStatus) return;

  const meeting = await prisma.meeting.findFirst({
    where: { id, customer: customerScope(user.roles, user.id) },
    select: { id: true, meetingStatus: true, outcome: true, customerId: true },
  });
  if (!meeting) return;

  await prisma.meeting.update({
    where: { id },
    data: {
      meetingStatus,
      outcome,
      ...(scheduledAt !== undefined && { scheduledAt }),
      ...(outcome && { completedAt: new Date() }),
    },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "meeting.updated",
    objectType: "meeting",
    objectId: id,
    customerId: meeting.customerId,
    before: { meetingStatus: meeting.meetingStatus, outcome: meeting.outcome },
    after: { meetingStatus, outcome },
  });

  revalidatePath("/follow-ups");
}
