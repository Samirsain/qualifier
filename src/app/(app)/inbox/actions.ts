"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";
import { sendToCustomer } from "@/lib/whatsapp/outbound";

export type ReplyState = { error?: string; sent?: boolean };

/** Reply, or send a permitted template, from the inbox (UI-003). */
export async function sendReply(
  _prev: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const user = await assertPermission("conversation:reply");

  const customerId = z.uuid().safeParse(formData.get("customerId"));
  if (!customerId.success) return { error: "Select a conversation first." };

  const permitted = await prisma.customer.findFirst({
    where: { id: customerId.data },
    select: { id: true },
  });
  if (!permitted) return { error: "You cannot message this customer." };

  const templateId = String(formData.get("templateId") ?? "");
  const body = String(formData.get("body") ?? "");

  const result = await sendToCustomer({
    customerId: customerId.data,
    actorUserId: user.id,
    body: body || undefined,
    templateId: templateId || undefined,
  });

  if (!result.ok) return { error: result.reason };

  revalidatePath("/inbox");
  return { sent: true };
}

/** Mark the thread read when staff open it. */
export async function markRead(customerId: string) {
  await assertPermission("conversation:read");
  const permitted = await prisma.customer.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!permitted) return;

  await prisma.conversation.updateMany({
    where: { customerId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
}

/** Close or reopen a conversation (BR-07). */
export async function setConversationStatus(formData: FormData) {
  const user = await assertPermission("conversation:reply");

  const conversationId = z.uuid().parse(formData.get("conversationId"));
  const status = z.enum(["OPEN", "CLOSED"]).parse(formData.get("status"));

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: { id: true, status: true, customerId: true },
  });
  if (!conversation || conversation.status === status) return;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: status === "CLOSED" ? "conversation.closed" : "conversation.reopened",
    objectType: "conversation",
    objectId: conversationId,
    customerId: conversation.customerId,
    before: { status: conversation.status },
    after: { status },
  });

  revalidatePath("/inbox");
}
