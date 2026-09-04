import "server-only";
import { logActivity } from "@/lib/activity";
import { parseSegment, segmentToWhere } from "@/lib/campaigns/segment";
import { prisma } from "@/lib/prisma";
import { sendToCustomer } from "@/lib/whatsapp/outbound";

/**
 * Campaign audience resolution and dispatch (BR-19…21, FR-046…050).
 *
 * Two rules from the documentation shape this file:
 *
 * 1. Doc 12 §11 — "snapshot launched campaign audiences". The audience is
 *    frozen into `campaign_audiences` at launch. Later edits to a customer
 *    cannot retroactively change who a campaign was sent to, so reported
 *    numbers stay explainable.
 *
 * 2. TC-016 — a stopped campaign initiates no new sends. Status is re-read
 *    inside the send loop, not just once at the start, so a stop lands
 *    mid-batch rather than after it.
 */

const SEND_BATCH = 50;

export type ResolvedAudience = {
  total: number;
  sample: { id: string; name: string; phoneE164: string }[];
  excludedOptOut: number;
};

/**
 * Preview the audience without writing anything (UI-010, TC-015).
 * Uses the same `segmentToWhere` the launch uses, so the preview a manager
 * approves is the audience that actually gets frozen.
 */
export async function previewAudience(
  segmentJson: unknown,
  sampleSize = 10,
): Promise<ResolvedAudience> {
  const segment = parseSegment(segmentJson);
  const where = segmentToWhere(segment);

  const [total, sample, excludedOptOut] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: sampleSize,
      select: { id: true, name: true, phoneE164: true },
    }),
    // How many the opt-out rule removed, so the number is visible rather than
    // a silent difference the manager has to work out.
    prisma.customer.count({
      where: {
        AND: [
          segmentToWhere(segment, { includeOptedOut: true }),
          { optedOutAt: { not: null } },
        ],
      },
    }),
  ]);

  return { total, sample, excludedOptOut };
}

/**
 * Freeze the audience. Called once, when a campaign leaves Draft/Scheduled.
 * Idempotent: re-running finds the rows already there and adds nothing.
 */
export async function snapshotAudience(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, targetSegmentDefinition: true },
  });
  if (!campaign) return 0;

  const existing = await prisma.campaignAudience.count({ where: { campaignId } });
  if (existing > 0) return existing;

  const where = segmentToWhere(parseSegment(campaign.targetSegmentDefinition));
  const customers = await prisma.customer.findMany({
    where,
    select: { id: true },
  });

  if (customers.length === 0) return 0;

  await prisma.campaignAudience.createMany({
    data: customers.map((c) => ({
      campaignId,
      customerId: c.id,
      inclusionReason: "matched segment at launch",
    })),
    skipDuplicates: true,
  });

  return customers.length;
}

export type DispatchResult = {
  campaignId: string;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  stopped: boolean;
};

/**
 * Send the next batch for one running campaign.
 *
 * Per-customer idempotency is the `campaign_deliveries` unique index on
 * (campaignId, customerId): a delivery row is claimed before the provider
 * call, so a replayed dispatch cannot message the same customer twice.
 */
export async function dispatchCampaign(
  campaignId: string,
  batchSize = SEND_BATCH,
): Promise<DispatchResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true, templateId: true, name: true },
  });

  const result: DispatchResult = {
    campaignId,
    sent: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
    stopped: false,
  };

  if (!campaign || campaign.status !== "RUNNING") {
    result.stopped = true;
    return result;
  }

  const pending = await prisma.campaignAudience.findMany({
    where: {
      campaignId,
      excludedReason: null,
      customer: { deliveries: { none: { campaignId } } },
    },
    take: batchSize,
    select: { customerId: true },
  });

  for (const { customerId } of pending) {
    // TC-016: re-read status before every send, so a stop takes effect
    // immediately rather than at the end of the batch.
    const current = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (current?.status !== "RUNNING") {
      result.stopped = true;
      break;
    }

    // Claim the delivery first. A unique-constraint failure means another
    // worker already has this customer.
    let claimed = true;
    try {
      await prisma.campaignDelivery.create({
        data: { campaignId, customerId, status: "QUEUED" },
      });
    } catch {
      claimed = false;
    }
    if (!claimed) {
      result.skipped++;
      continue;
    }

    const send = await sendToCustomer({
      customerId,
      templateId: campaign.templateId,
      campaignId,
    });

    if (send.ok) {
      await prisma.campaignDelivery.update({
        where: { campaignId_customerId: { campaignId, customerId } },
        data: { status: "SENT", sentAt: new Date(), messageId: send.messageId },
      });
      result.sent++;
    } else {
      await prisma.campaignDelivery.update({
        where: { campaignId_customerId: { campaignId, customerId } },
        data: { status: "FAILED", result: send.reason },
      });
      result.failed++;
    }
  }

  result.remaining = await prisma.campaignAudience.count({
    where: {
      campaignId,
      excludedReason: null,
      customer: { deliveries: { none: { campaignId } } },
    },
  });

  // A campaign that has reached everyone is Completed, not left Running.
  if (result.remaining === 0 && !result.stopped) {
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await logActivity({
      eventType: "campaign.completed",
      objectType: "campaign",
      objectId: campaignId,
      metadata: { name: campaign.name },
    });
  }

  return result;
}

/**
 * Start any campaign whose schedule has arrived, then dispatch every running
 * one. Driven by the same tick endpoint as the automation worker.
 */
export async function dispatchDueCampaigns(): Promise<DispatchResult[]> {
  const now = new Date();

  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true, name: true },
  });

  for (const campaign of due) {
    await snapshotAudience(campaign.id);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING", startedAt: now },
    });
    await logActivity({
      eventType: "campaign.started",
      objectType: "campaign",
      objectId: campaign.id,
      metadata: { name: campaign.name, trigger: "schedule" },
    });
  }

  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
  });

  const results: DispatchResult[] = [];
  for (const campaign of running) {
    results.push(await dispatchCampaign(campaign.id));
  }
  return results;
}

/** Campaign KPI set from doc 12 §7. */
export async function campaignMetrics(campaignId: string) {
  const [audience, deliveries, leads, calls, meetings, conversions] =
    await Promise.all([
      prisma.campaignAudience.count({
        where: { campaignId, excludedReason: null },
      }),
      prisma.campaignDelivery.findMany({
        where: { campaignId },
        select: { status: true, readAt: true, deliveredAt: true, repliedAt: true },
      }),
      prisma.customer.count({
        where: { campaignId, lead: { isNot: null } },
      }),
      prisma.call.count({ where: { campaignId } }),
      prisma.meeting.count({
        where: { customer: { campaignId } },
      }),
      prisma.customer.count({
        where: { campaignId, interestStatus: "CONVERTED" },
      }),
    ]);

  const sent = deliveries.filter((d) => d.status !== "QUEUED" && d.status !== "FAILED").length;
  const delivered = deliveries.filter((d) => d.deliveredAt !== null).length;
  const read = deliveries.filter((d) => d.readAt !== null).length;
  const replies = deliveries.filter((d) => d.repliedAt !== null).length;
  const failed = deliveries.filter((d) => d.status === "FAILED").length;

  return {
    audience,
    sent,
    delivered,
    read,
    replies,
    failed,
    leads,
    calls,
    meetings,
    conversions,
    // Doc 12 §4: the denominator must be stated. This one is replies ÷ sent.
    // A campaign-attribution *window* is GAP-010 and is not applied.
    responseRate: sent > 0 ? replies / sent : null,
  };
}
