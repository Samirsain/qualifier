"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { segmentDefinition } from "@/lib/campaigns/segment";
import { snapshotAudience } from "@/lib/campaigns/runner";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";

export type CampaignState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

const campaignInput = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Name is required").max(160),
  purpose: z.string().trim().max(500).optional(),
  templateId: z.uuid("Select an approved template"),
  scheduledAt: z.union([z.coerce.date(), z.literal("")]).optional(),
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

/** Read the segment fields out of the form into a definition object. */
function segmentFromForm(formData: FormData) {
  const list = (key: string) =>
    formData.getAll(key).map(String).filter((v) => v !== "");
  const date = (key: string) => {
    const raw = String(formData.get(key) ?? "");
    return raw === "" ? null : raw;
  };

  return segmentDefinition.safeParse({
    sourceIds: list("sourceIds"),
    campaignIds: list("campaignIds"),
    tagNames: list("tagNames"),
    tagMatch: String(formData.get("tagMatch") ?? "ANY"),
    interestStatuses: list("interestStatuses"),
    leadStageCodes: list("leadStageCodes"),
    customerStatuses: list("customerStatuses"),
    customerTypes: list("customerTypes"),
    assignedStaffIds: list("assignedStaffIds"),
    onlyUnassigned: formData.get("onlyUnassigned") === "on",
    createdAfter: date("createdAfter"),
    createdBefore: date("createdBefore"),
  });
}

/** Create or update a Draft (FR-046, FR-047, FR-048). */
export async function saveCampaign(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const user = await assertPermission(
    formData.get("id") ? "campaign:update" : "campaign:create",
  );

  const parsed = campaignInput.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    purpose: formData.get("purpose") ?? "",
    templateId: formData.get("templateId"),
    scheduledAt: formData.get("scheduledAt") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const segment = segmentFromForm(formData);
  if (!segment.success) {
    return { error: "The audience filters are not valid." };
  }

  const template = await prisma.template.findUnique({
    where: { id: parsed.data.templateId },
    select: { id: true, active: true, archivedAt: true },
  });
  if (!template || !template.active || template.archivedAt) {
    return { fieldErrors: { templateId: "That template is archived or inactive." } };
  }

  const { id, name, purpose, templateId } = parsed.data;
  const scheduledAt =
    parsed.data.scheduledAt instanceof Date ? parsed.data.scheduledAt : null;

  if (id) {
    // A campaign that has started is settled — editing it would make its
    // reported audience and content disagree with what customers received.
    const existing = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) return { error: "Campaign not found." };
    if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
      return { error: `A ${existing.status.toLowerCase()} campaign cannot be edited.` };
    }

    await prisma.campaign.update({
      where: { id },
      data: {
        name,
        purpose: purpose || null,
        templateId,
        scheduledAt,
        targetSegmentDefinition: segment.data as never,
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
      },
    });

    await logActivity({
      actorUserId: user.id,
      eventType: "campaign.updated",
      objectType: "campaign",
      objectId: id,
      after: { name, scheduledAt: scheduledAt?.toISOString() ?? null },
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    return { saved: true };
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      purpose: purpose || null,
      templateId,
      scheduledAt,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
      targetSegmentDefinition: segment.data as never,
      createdById: user.id,
    },
    select: { id: true },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "campaign.created",
    objectType: "campaign",
    objectId: campaign.id,
    after: { name, scheduledAt: scheduledAt?.toISOString() ?? null },
  });

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

/**
 * Start now. Freezes the audience before the status changes, so a campaign is
 * never Running against an unresolved audience (doc 12 §11).
 */
export async function startCampaign(formData: FormData) {
  const user = await assertPermission("campaign:start");
  const id = z.uuid().parse(formData.get("id"));

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!campaign) return;
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") return;

  const audience = await snapshotAudience(id);

  await prisma.campaign.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "campaign.started",
    objectType: "campaign",
    objectId: id,
    metadata: { name: campaign.name, audience, trigger: "manual" },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

/**
 * Lifecycle controls (FR-049): pause, resume, stop, archive.
 *
 * Stop is terminal — a stopped campaign cannot be resumed, because resuming
 * would send to people a manager deliberately cut off. Pause is the reversible
 * control; the UI labels them accordingly.
 */
// Manual transitions only. RUNNING → COMPLETED is not here because a person
// does not declare a campaign complete — the dispatcher does, once every
// audience member has been reached.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "RUNNING", "STOPPED", "ARCHIVED"],
  RUNNING: ["PAUSED", "STOPPED"],
  PAUSED: ["RUNNING", "STOPPED"],
  COMPLETED: ["ARCHIVED"],
  STOPPED: ["ARCHIVED"],
  ARCHIVED: [],
};

export async function setCampaignStatus(formData: FormData) {
  const status = z
    .enum(["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "STOPPED", "ARCHIVED"])
    .parse(formData.get("status"));

  const user = await assertPermission(
    status === "RUNNING" ? "campaign:start" : "campaign:stop",
  );
  const id = z.uuid().parse(formData.get("id"));

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!campaign) return;

  if (!ALLOWED_TRANSITIONS[campaign.status]?.includes(status)) return;

  // Resuming from Paused may be the first time it actually runs.
  if (status === "RUNNING") await snapshotAudience(id);

  await prisma.campaign.update({
    where: { id },
    data: {
      status,
      ...(status === "RUNNING" && { startedAt: new Date() }),
    },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: `campaign.${status.toLowerCase()}`,
    objectType: "campaign",
    objectId: id,
    before: { status: campaign.status },
    after: { status },
    metadata: { name: campaign.name },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}
