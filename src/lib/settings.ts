import "server-only";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

/**
 * The two rows in `system_settings` the product actually reads:
 * `automation.pause_all` (the emergency stop) and `optout.keywords`.
 *
 * Every write is logged, because both change what happens to real numbers.
 */

export async function getSetting(key: string): Promise<unknown> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: unknown,
  actorUserId?: string,
) {
  const before = await prisma.systemSetting.findUnique({ where: { key } });

  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });

  await logActivity({
    actorUserId: actorUserId ?? null,
    eventType: "settings.changed",
    objectType: "system_setting",
    objectId: key,
    before: { value: (before?.value ?? null) as never },
    after: { value: value as never },
  });
}
