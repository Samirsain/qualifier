import "server-only";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

/**
 * Business configuration for decisions the source has not made yet.
 *
 * A key seeded to `null` means "still TBD". Callers must treat null as
 * undecided and refuse to act, rather than falling back to a default that
 * would silently become the business rule.
 */

export async function getSetting(key: string): Promise<unknown> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getSettings(
  keys: string[],
): Promise<Record<string, unknown>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
  });
  const out: Record<string, unknown> = Object.fromEntries(
    keys.map((k) => [k, null]),
  );
  for (const row of rows) out[row.key] = row.value;
  return out;
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
