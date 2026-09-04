import { CampaignForm } from "../form";
import { campaignFormOptions } from "../options";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requirePermission("campaign:create");
  const options = await campaignFormOptions();

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Define who it reaches, what it sends and when. Nothing is sent until you start it."
      />
      <CampaignForm options={options} />
    </>
  );
}
