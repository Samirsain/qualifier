import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Audit trail per 11_3_Percent_Club_Security.md §10 and F-021 (BR-38).
 * Records actor, target, action, time and before/after where safe.
 * Customer phone/email must not be copied into metadata (§5).
 */
export async function logActivity(entry: {
  actorUserId?: string | null;
  eventType: string;
  objectType: string;
  objectId?: string | null;
  customerId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.activityLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      eventType: entry.eventType,
      objectType: entry.objectType,
      objectId: entry.objectId ?? null,
      customerId: entry.customerId ?? null,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
    },
  });
}
