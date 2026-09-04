import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Campaign audience segmentation (BR-20, FR-048, doc 17 §12).
 *
 * The segmentable fields are the ones the source names: source, campaign,
 * tags, lead stage, interest status, customer status, existing-customer
 * status, plus entry date. Project/plot interest is deliberately absent —
 * GAP-033 leaves that data model undefined, so there is no field to filter on
 * and inventing one would fabricate a business structure.
 *
 * This module is pure: a definition in, a Prisma `where` out. That keeps the
 * preview shown to a manager and the audience resolved at launch provably
 * identical — they call the same function.
 */

export const segmentDefinition = z.object({
  sourceIds: z.array(z.uuid()).default([]),
  campaignIds: z.array(z.uuid()).default([]),
  tagNames: z.array(z.string().min(1).max(60)).default([]),
  /** ALL = customer must carry every tag; ANY = at least one. */
  tagMatch: z.enum(["ANY", "ALL"]).default("ANY"),
  interestStatuses: z
    .array(
      z.enum([
        "NOT_YET_CONTACTED",
        "INTERESTED",
        "VERY_INTERESTED",
        "NOT_INTERESTED",
        "REVISIT_LATER",
        "CALL_REQUIRED",
        "MEETING_REQUIRED",
        "CONVERTED",
        "CLOSED",
      ]),
    )
    .default([]),
  leadStageCodes: z.array(z.string().min(1).max(60)).default([]),
  /** GAP-006 / GAP-032 — free text because the taxonomies are undecided. */
  customerStatuses: z.array(z.string().min(1).max(60)).default([]),
  customerTypes: z.array(z.string().min(1).max(60)).default([]),
  assignedStaffIds: z.array(z.uuid()).default([]),
  /** Unassigned customers are a real cohort, so it is its own switch. */
  onlyUnassigned: z.boolean().default(false),
  createdAfter: z.coerce.date().nullable().default(null),
  createdBefore: z.coerce.date().nullable().default(null),
});

export type SegmentDefinition = z.infer<typeof segmentDefinition>;

export const EMPTY_SEGMENT: SegmentDefinition = segmentDefinition.parse({});

/**
 * Turn a segment definition into a Prisma filter.
 *
 * Two exclusions are unconditional and not part of the definition, because
 * they are responsibilities rather than preferences (BR-49, BR-51):
 *   - opted-out customers are never in a campaign audience;
 *   - a customer with no phone number cannot be messaged.
 */
export function segmentToWhere(
  segment: SegmentDefinition,
  options: { includeOptedOut?: boolean } = {},
): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];

  // Responsible communication — never overridable from the UI. The only
  // caller that lifts it is the preview, to *count* who it removed.
  if (!options.includeOptedOut) and.push({ optedOutAt: null });

  if (segment.sourceIds.length > 0) {
    and.push({ sourceId: { in: segment.sourceIds } });
  }

  if (segment.campaignIds.length > 0) {
    and.push({ campaignId: { in: segment.campaignIds } });
  }

  if (segment.tagNames.length > 0) {
    if (segment.tagMatch === "ALL") {
      // Every tag must be present, so each becomes its own `some` clause.
      for (const name of segment.tagNames) {
        and.push({ tags: { some: { tag: { name } } } });
      }
    } else {
      and.push({ tags: { some: { tag: { name: { in: segment.tagNames } } } } });
    }
  }

  if (segment.interestStatuses.length > 0) {
    and.push({ interestStatus: { in: segment.interestStatuses } });
  }

  if (segment.leadStageCodes.length > 0) {
    and.push({ lead: { stage: { code: { in: segment.leadStageCodes } } } });
  }

  if (segment.customerStatuses.length > 0) {
    and.push({ customerStatus: { in: segment.customerStatuses } });
  }

  if (segment.customerTypes.length > 0) {
    and.push({ customerType: { in: segment.customerTypes } });
  }

  if (segment.onlyUnassigned) {
    and.push({ assignedStaffId: null });
  } else if (segment.assignedStaffIds.length > 0) {
    and.push({ assignedStaffId: { in: segment.assignedStaffIds } });
  }

  if (segment.createdAfter) {
    and.push({ createdAt: { gte: segment.createdAfter } });
  }

  if (segment.createdBefore) {
    and.push({ createdAt: { lte: segment.createdBefore } });
  }

  return { AND: and };
}

/** Human-readable summary for the audience preview and campaign detail. */
export function describeSegment(segment: SegmentDefinition): string[] {
  const parts: string[] = [];

  if (segment.sourceIds.length > 0) {
    parts.push(`${segment.sourceIds.length} source(s)`);
  }
  if (segment.campaignIds.length > 0) {
    parts.push(`from ${segment.campaignIds.length} earlier campaign(s)`);
  }
  if (segment.tagNames.length > 0) {
    parts.push(
      `${segment.tagMatch === "ALL" ? "all" : "any"} of tags: ${segment.tagNames.join(", ")}`,
    );
  }
  if (segment.interestStatuses.length > 0) {
    parts.push(`interest: ${segment.interestStatuses.join(", ")}`);
  }
  if (segment.leadStageCodes.length > 0) {
    parts.push(`lead stage: ${segment.leadStageCodes.join(", ")}`);
  }
  if (segment.customerStatuses.length > 0) {
    parts.push(`customer status: ${segment.customerStatuses.join(", ")}`);
  }
  if (segment.customerTypes.length > 0) {
    parts.push(`customer type: ${segment.customerTypes.join(", ")}`);
  }
  if (segment.onlyUnassigned) {
    parts.push("unassigned only");
  } else if (segment.assignedStaffIds.length > 0) {
    parts.push(`${segment.assignedStaffIds.length} owner(s)`);
  }
  if (segment.createdAfter) {
    parts.push(`added on or after ${segment.createdAfter.toLocaleDateString()}`);
  }
  if (segment.createdBefore) {
    parts.push(`added on or before ${segment.createdBefore.toLocaleDateString()}`);
  }

  if (parts.length === 0) parts.push("every customer who has not opted out");
  return parts;
}

/** Parse a stored JSON definition, falling back to the empty segment. */
export function parseSegment(value: unknown): SegmentDefinition {
  const parsed = segmentDefinition.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_SEGMENT;
}
