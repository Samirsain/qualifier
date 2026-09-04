import { notFound, redirect } from "next/navigation";
import { CampaignForm } from "../../form";
import { campaignFormOptions } from "../../options";
import { PageHeader } from "@/components/ui";
import { parseSegment } from "@/lib/campaigns/segment";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({
  params,
}: PageProps<"/campaigns/[id]/edit">) {
  await requirePermission("campaign:update");
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) notFound();

  // Once a campaign has started, what it sent is a historical fact. Editing is
  // refused rather than quietly discarded, so the URL cannot be used to bypass
  // the same rule the server action enforces.
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    redirect(`/campaigns/${id}`);
  }

  const options = await campaignFormOptions();
  const segment = parseSegment(campaign.targetSegmentDefinition);

  return (
    <>
      <PageHeader
        title={`Edit ${campaign.name}`}
        description="Only a Draft or Scheduled campaign can be changed."
      />
      <CampaignForm
        options={options}
        draft={{
          id: campaign.id,
          name: campaign.name,
          purpose: campaign.purpose,
          templateId: campaign.templateId,
          scheduledAt: campaign.scheduledAt,
          segment: {
            sourceIds: segment.sourceIds,
            campaignIds: segment.campaignIds,
            tagNames: segment.tagNames,
            tagMatch: segment.tagMatch,
            interestStatuses: segment.interestStatuses,
            leadStageCodes: segment.leadStageCodes,
            assignedStaffIds: segment.assignedStaffIds,
            onlyUnassigned: segment.onlyUnassigned,
            createdAfter: segment.createdAfter,
            createdBefore: segment.createdBefore,
          },
        }}
      />
    </>
  );
}
