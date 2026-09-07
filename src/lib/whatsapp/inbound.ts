import "server-only";
import { logActivity } from "@/lib/activity";
import { applyCustomerResponse } from "@/lib/automation/engine";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import type { InboundEvent } from "@/lib/whatsapp/adapter";

/**
 * Inbound flow (doc 10 §7): verify → normalize → dedupe → persist →
 * signal the automation engine.
 *
 * Dedupe is the `messages.provider_message_id` unique index, so a replayed
 * webhook is safe (§11 idempotency, DEV-004 completion criterion).
 */

export type IngestResult = {
  processed: number;
  duplicates: number;
  unknownCustomers: number;
};

export async function ingestEvents(events: InboundEvent[]): Promise<IngestResult> {
  const result: IngestResult = { processed: 0, duplicates: 0, unknownCustomers: 0 };

  for (const event of events) {
    if (event.kind === "status") {
      const updated = await applyStatus(event);
      if (updated) result.processed++;
      else result.duplicates++;
      continue;
    }

    const outcome = await applyInboundMessage(event);
    if (outcome === "duplicate") result.duplicates++;
    else if (outcome === "unknown-customer") result.unknownCustomers++;
    else result.processed++;
  }

  return result;
}

async function applyStatus(
  event: Extract<InboundEvent, { kind: "status" }>,
): Promise<boolean> {
  const message = await prisma.message.findUnique({
    where: { providerMessageId: event.providerMessageId },
    select: { id: true, deliveryStatus: true },
  });
  if (!message) return false;

  // Status events can arrive out of order; never move a message backwards.
  const rank = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const;
  if (rank[event.status] <= rank[message.deliveryStatus]) return false;

  await prisma.message.update({
    where: { id: message.id },
    data: {
      deliveryStatus: event.status,
      ...(event.status === "SENT" && { sentAt: event.at }),
      ...(event.status === "DELIVERED" && { deliveredAt: event.at }),
      ...(event.status === "READ" && { readAt: event.at }),
      ...(event.status === "FAILED" && {
        failedAt: event.at,
        failureCode: event.failureCode ?? null,
      }),
    },
  });

  return true;
}

async function applyInboundMessage(
  event: Extract<InboundEvent, { kind: "message" }>,
): Promise<"ok" | "duplicate" | "unknown-customer"> {
  const existing = await prisma.message.findUnique({
    where: { providerMessageId: event.providerMessageId },
    select: { id: true },
  });
  if (existing) return "duplicate";

  const customer = await prisma.customer.findUnique({
    where: { phoneE164: event.from },
    select: { id: true },
  });

  // An unknown number is not silently turned into a customer: GAP-004 (dedupe
  // and merge policy) and the source's customer-source requirement both need a
  // business decision first. The event is recorded so nothing is lost.
  if (!customer) {
    await logActivity({
      eventType: "whatsapp.inbound_unknown_customer",
      objectType: "message",
      objectId: event.providerMessageId,
      metadata: { reason: "no customer matches this phone number" },
    });
    return "unknown-customer";
  }

  let storedMessageId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const conversation =
      (await tx.conversation.findFirst({
        where: { customerId: customer.id, channel: "whatsapp", status: "OPEN" },
        select: { id: true },
      })) ??
      (await tx.conversation.create({
        data: { customerId: customer.id, channel: "whatsapp" },
        select: { id: true },
      }));

    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        customerId: customer.id,
        providerMessageId: event.providerMessageId,
        direction: "INBOUND",
        type: event.replyId ? "INTERACTIVE" : "TEXT",
        body: event.text,
        payload: event.replyId ? { replyId: event.replyId } : undefined,
        deliveryStatus: "DELIVERED",
        sentAt: event.receivedAt,
        deliveredAt: event.receivedAt,
      },
      select: { id: true },
    });
    storedMessageId = message.id;

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: event.receivedAt,
        unreadCount: { increment: 1 },
        status: "OPEN",
      },
    });

    await tx.customer.update({
      where: { id: customer.id },
      data: { lastInteractionAt: event.receivedAt },
    });

    await tx.activityLog.create({
      data: {
        eventType: "whatsapp.inbound_message",
        objectType: "message",
        objectId: message.id,
        customerId: customer.id,
      },
    });
  });

  // Opt-out is checked before anything else advances (doc 07 §10 exit paths).
  if (await isOptOut(event.text)) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { optedOutAt: event.receivedAt },
    });
    await prisma.automationRun.updateMany({
      where: { customerId: customer.id, state: { in: ["RUNNING", "WAITING"] } },
      data: {
        state: "STOPPED",
        stoppedAt: event.receivedAt,
        stopReason: "customer opted out",
        nextActionAt: null,
      },
    });
    await logActivity({
      eventType: "customer.opted_out",
      objectType: "customer",
      objectId: customer.id,
      customerId: customer.id,
    });
    return "ok";
  }

  /*
   * A reply branches any waiting journey and, by doing so, cancels the pending
   * no-response follow-up that journey was waiting on (BR-14 / F-007).
   * Runs parked on a *timer* rather than a question keep their timer: the
   * journey step decides what a reply means, not the ingest layer.
   */
  await applyCustomerResponse({
    customerId: customer.id,
    text: event.text,
    replyId: event.replyId,
    messageId: storedMessageId,
  });

  return "ok";
}

/**
 * GAP-018 — the opt-out keyword policy is an open business decision, so the
 * list is configuration. An empty list means no keyword triggers suppression;
 * nothing is assumed on the customer's behalf.
 */
async function isOptOut(text: string): Promise<boolean> {
  const configured = await getSetting("optout.keywords");
  if (!Array.isArray(configured) || configured.length === 0) return false;
  const normalised = text.trim().toUpperCase();
  return configured.some(
    (keyword) => typeof keyword === "string" && keyword.toUpperCase() === normalised,
  );
}
