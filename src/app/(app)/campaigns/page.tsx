import Link from "next/link";
import { setCampaignStatus } from "./actions";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
  cx,
} from "@/components/ui";
import { CAMPAIGN_STATUS_LABELS, statusTone } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const TABS = [
  "all",
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "STOPPED",
  "ARCHIVED",
] as const;

/**
 * UI-009 — Campaigns. Status tabs plus the per-campaign metrics the source
 * requires: audience, sent, delivered, read, replies, leads, result (BR-21).
 */
export default async function CampaignsPage({
  searchParams,
}: PageProps<"/campaigns">) {
  const user = await requirePermission("campaign:read");
  const params = await searchParams;

  const tab = (
    TABS.includes(params.status as (typeof TABS)[number]) ? params.status : "all"
  ) as (typeof TABS)[number];

  const where: Prisma.CampaignWhereInput =
    tab === "all"
      ? { status: { not: "ARCHIVED" } }
      : { status: tab as Prisma.EnumCampaignStatusFilter["equals"] };

  const [campaigns, counts] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: [{ scheduledAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: {
        template: { select: { name: true } },
        createdBy: { select: { displayName: true } },
        _count: { select: { audiences: true } },
      },
    }),
    prisma.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));

  // One grouped query for delivery facts rather than N per campaign.
  const deliveryRows =
    campaigns.length === 0
      ? []
      : await prisma.campaignDelivery.findMany({
          where: { campaignId: { in: campaigns.map((c) => c.id) } },
          select: {
            campaignId: true,
            status: true,
            deliveredAt: true,
            readAt: true,
            repliedAt: true,
            leadGenerated: true,
          },
        });

  type Facts = { sent: number; delivered: number; read: number; replies: number; leads: number };
  const facts = new Map<string, Facts>();
  for (const row of deliveryRows) {
    const f =
      facts.get(row.campaignId) ??
      { sent: 0, delivered: 0, read: 0, replies: 0, leads: 0 };
    if (row.status !== "QUEUED" && row.status !== "FAILED") f.sent++;
    if (row.deliveredAt) f.delivered++;
    if (row.readAt) f.read++;
    if (row.repliedAt) f.replies++;
    if (row.leadGenerated) f.leads++;
    facts.set(row.campaignId, f);
  }

  const canStop = can(user.roles, "campaign:stop");

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Audience, template, schedule and results for every organised send."
        actions={
          can(user.roles, "campaign:create") && (
            <Link href="/campaigns/new" className={buttonClass.primary}>
              New campaign
            </Link>
          )
        }
      />

      <nav aria-label="Campaign status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((value) => (
          <Link
            key={value}
            href={value === "all" ? "/campaigns" : { pathname: "/campaigns", query: { status: value } }}
            aria-current={tab === value ? "page" : undefined}
            className={cx(
              "rounded-[var(--radius-sm)] border px-3 py-2",
              tab === value
                ? "border-[color:var(--color-action-primary)] bg-[color:var(--color-action-primary)] text-white"
                : "border-[color:var(--color-border-default)]",
            )}
          >
            {value === "all"
              ? "All active"
              : `${CAMPAIGN_STATUS_LABELS[value]} (${countByStatus.get(value) ?? 0})`}
          </Link>
        ))}
      </nav>

      <Card>
        {campaigns.length === 0 ? (
          <EmptyState
            title={tab === "all" ? "No campaigns yet" : "Nothing in this status"}
            description="A campaign defines an audience, an approved template and a schedule."
            action={
              can(user.roles, "campaign:create") && (
                <Link href="/campaigns/new" className={buttonClass.primary}>
                  Create the first campaign
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption="Campaigns"
            head={[
              "Name",
              "Template",
              "Schedule",
              "Status",
              "Audience",
              "Sent",
              "Delivered",
              "Read",
              "Replies",
              "Leads",
              ...(canStop ? ["Controls"] : []),
            ]}
          >
            {campaigns.map((c) => {
              const f = facts.get(c.id) ?? {
                sent: 0,
                delivered: 0,
                read: 0,
                replies: 0,
                leads: 0,
              };
              return (
                <Row key={c.id}>
                  <Cell>
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.purpose && (
                      <p className="max-w-xs truncate text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                        {c.purpose}
                      </p>
                    )}
                  </Cell>
                  <Cell>{c.template.name}</Cell>
                  <Cell>{c.scheduledAt?.toLocaleString() ?? "Not scheduled"}</Cell>
                  <Cell>
                    <Badge tone={statusTone(c.status)}>
                      {CAMPAIGN_STATUS_LABELS[c.status]}
                    </Badge>
                  </Cell>
                  <Cell className="tabular-nums">{c._count.audiences}</Cell>
                  <Cell className="tabular-nums">{f.sent}</Cell>
                  <Cell className="tabular-nums">{f.delivered}</Cell>
                  <Cell className="tabular-nums">{f.read}</Cell>
                  <Cell className="tabular-nums">{f.replies}</Cell>
                  <Cell className="tabular-nums">{f.leads}</Cell>
                  {canStop && (
                    <Cell>
                      <div className="flex flex-wrap gap-2">
                        {c.status === "RUNNING" && (
                          <>
                            <form action={setCampaignStatus}>
                              <input type="hidden" name="id" value={c.id} />
                              <input type="hidden" name="status" value="PAUSED" />
                              <button type="submit" className={buttonClass.secondary}>
                                Pause
                              </button>
                            </form>
                            <form action={setCampaignStatus}>
                              <input type="hidden" name="id" value={c.id} />
                              <input type="hidden" name="status" value="STOPPED" />
                              <button type="submit" className={buttonClass.danger}>
                                Stop
                              </button>
                            </form>
                          </>
                        )}
                        {c.status === "PAUSED" && (
                          <form action={setCampaignStatus}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="status" value="RUNNING" />
                            <button type="submit" className={buttonClass.secondary}>
                              Resume
                            </button>
                          </form>
                        )}
                        {["COMPLETED", "STOPPED", "DRAFT"].includes(c.status) && (
                          <form action={setCampaignStatus}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="status" value="ARCHIVED" />
                            <button type="submit" className={buttonClass.secondary}>
                              Archive
                            </button>
                          </form>
                        )}
                      </div>
                    </Cell>
                  )}
                </Row>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
