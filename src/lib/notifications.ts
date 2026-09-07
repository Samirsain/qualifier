import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Notifications (F-019, BR-35). Every notification must lead to a clear
 * action, so each one carries the related object and a link target.
 *
 * GAP-013 — channels and urgency levels are an open business decision, so
 * these are in-app records only. No email/SMS/push channel is invented, and no
 * escalation priority is assigned.
 */

export type NotifiableEvent = "customer.qualified";

export async function notify(entry: {
  userId: string | null | undefined;
  eventType: NotifiableEvent;
  title: string;
  body?: string;
  relatedType: string;
  relatedId: string;
}) {
  if (!entry.userId) return; // unassigned work notifies nobody until it is owned
  await prisma.notification.create({
    data: {
      userId: entry.userId,
      eventType: entry.eventType,
      title: entry.title,
      body: entry.body ?? null,
      relatedType: entry.relatedType,
      relatedId: entry.relatedId,
    },
  });
}

/** Where a notification should take the user (F-019 "navigation to object"). */
export function notificationHref(relatedType: string): string {
  switch (relatedType) {
    case "customer":
      return "/qualified";
    case "conversation":
      return "/inbox";
    default:
      return "/";
  }
}
