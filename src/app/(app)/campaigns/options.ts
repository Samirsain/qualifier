import "server-only";
import { prisma } from "@/lib/prisma";
import type { CampaignFormOptions } from "./form";

/** Reference data for the segment builder and template picker. */
export async function campaignFormOptions(): Promise<CampaignFormOptions> {
  const [sources, templates, tags, stages, staff, earlierCampaigns] =
    await Promise.all([
      prisma.source.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Only templates that can actually be sent appear in the picker.
      prisma.template.findMany({
        where: { active: true, archivedAt: null },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, name: true, category: true },
      }),
      prisma.tag.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
      prisma.leadStage.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        select: { code: true, name: true },
      }),
      prisma.user.findMany({
        where: {
          status: "ACTIVE",
          userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } },
        },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true },
      }),
      prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, name: true },
      }),
    ]);

  return { sources, templates, tags, stages, staff, earlierCampaigns };
}
