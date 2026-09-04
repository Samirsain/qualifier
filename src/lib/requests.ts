import "server-only";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Call and meeting requirements (F-015 / BR-27, F-016 / BR-28).
 *
 * Both are created either by staff from the CRM or by an automation when a
 * customer asks for contact. This module is the single creation point so the
 * two callers cannot drift.
 */

export async function createCallRequest(input: {
  customerId: string;
  requirement: string;
  actorUserId?: string | null;
  campaignId?: string | null;
  assignedStaffId?: string | null;
  notes?: string | null;
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true, sourceId: true, assignedStaffId: true },
  });
  if (!customer) return null;

  // GAP-005 — no automatic routing algorithm is defined, so the request
  // inherits the customer's existing owner and is otherwise left unassigned
  // for a manager to route. Nothing is round-robined on a guess.
  const assignedStaffId = input.assignedStaffId ?? customer.assignedStaffId;

  const call = await prisma.call.create({
    data: {
      customerId: customer.id,
      requirement: input.requirement,
      sourceId: customer.sourceId,
      campaignId: input.campaignId ?? null,
      assignedStaffId,
      status: assignedStaffId ? "ASSIGNED" : "NEW",
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: { interestStatus: "CALL_REQUIRED" },
  });

  await notify({
    userId: assignedStaffId,
    eventType: "call.requested",
    title: `${customer.name} requested a call`,
    body: input.requirement,
    relatedType: "call",
    relatedId: call.id,
  });

  await logActivity({
    actorUserId: input.actorUserId ?? null,
    eventType: "call.requested",
    objectType: "call",
    objectId: call.id,
    customerId: customer.id,
    after: { requirement: input.requirement, assignedStaffId },
  });

  return call;
}

export async function createMeetingRequest(input: {
  customerId: string;
  requirement: string;
  actorUserId?: string | null;
  assignedStaffId?: string | null;
  scheduledAt?: Date | null;
  notes?: string | null;
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true, sourceId: true, assignedStaffId: true },
  });
  if (!customer) return null;

  const assignedStaffId = input.assignedStaffId ?? customer.assignedStaffId;

  const meeting = await prisma.meeting.create({
    data: {
      customerId: customer.id,
      requirement: input.requirement,
      sourceId: customer.sourceId,
      assignedStaffId,
      scheduledAt: input.scheduledAt ?? null,
      // GAP-007: the meeting-status taxonomy is undefined. "New" is a label,
      // not an approved production value.
      meetingStatus: "New",
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: { interestStatus: "MEETING_REQUIRED" },
  });

  await notify({
    userId: assignedStaffId,
    eventType: "meeting.requested",
    title: `${customer.name} requested a meeting`,
    body: input.requirement,
    relatedType: "meeting",
    relatedId: meeting.id,
  });

  await logActivity({
    actorUserId: input.actorUserId ?? null,
    eventType: "meeting.requested",
    objectType: "meeting",
    objectId: meeting.id,
    customerId: customer.id,
    after: { requirement: input.requirement, assignedStaffId },
  });

  return meeting;
}
