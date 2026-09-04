"use server";

import { segmentDefinition } from "@/lib/campaigns/segment";
import { previewAudience } from "@/lib/campaigns/runner";
import { assertPermission } from "@/lib/session";

export type PreviewResult = {
  total: number;
  excludedOptOut: number;
  sample: { id: string; name: string; phoneE164: string }[];
  error?: string;
};

/**
 * Resolve the audience for the current filters without writing anything
 * (UI-010 "resolved audience preview", TC-015).
 */
export async function resolveAudience(
  _prev: PreviewResult | null,
  formData: FormData,
): Promise<PreviewResult> {
  await assertPermission("campaign:read");

  const list = (key: string) =>
    formData.getAll(key).map(String).filter((v) => v !== "");
  const date = (key: string) => {
    const raw = String(formData.get(key) ?? "");
    return raw === "" ? null : raw;
  };

  const parsed = segmentDefinition.safeParse({
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

  if (!parsed.success) {
    return {
      total: 0,
      excludedOptOut: 0,
      sample: [],
      error: "The audience filters are not valid.",
    };
  }

  const audience = await previewAudience(parsed.data);
  return {
    total: audience.total,
    excludedOptOut: audience.excludedOptOut,
    sample: audience.sample,
  };
}
