import Link from "next/link";
import { notFound } from "next/navigation";
import { setCampaignStatus, startCampaign } from "../actions";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  StatTile,
  Table,
  buttonClass,
  cx,
} from "@/components/ui";
import { campaignMetrics } from "@/lib/campaigns/runner";
import { describeSegment, parseSegment } from "@/lib/campaigns/segment";
import { CAMPAIGN_STATUS_LABELS, statusTone, titleCase } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * UI-011 — Campaign Details. Configuration, audience, the doc 12 §7 KPI set,
 * per-customer delivery inspection and failure review.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: PageProps<"/campaigns/[id]">) {
  const user = await requirePermission("campaign:read");
  const { id } = await params;
  const query = await searchParams;
  const showFailuresOnly = query.failures === "1";

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, name: true, category: true, body: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  if (!campaign) notFound();

  const [metrics, deliveries, pendingCount] = await Promise.all([
    campaignMetrics(id),
    prisma.campaignDelivery.findMany({
      where: { campaignId: id, ...(showFailuresOnly && { status: "FAILED" }) },
      orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }],
      take: 100,
      include: { customer: { select: { id: true, name: true, phoneE164: true } } },
    }),
    prisma.campaignAudience.count({
      where: {
        campaignId: id,
        excludedReason: null,
        customer: { deliveries: { none: { campaignId: id } } },
      },
    }),
  ]);

  const segment = parseSegment(campaign.targetSegmentDefinition);
  const canStop = can(user.roles, "campaign:stop");
  const canStart = can(user.roles, "campaign:start");
  const editable = campaign.status === "DRAFT" || campaign.status === "SCHEDULED";

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={campaign.purpose ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(campaign.status)}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>

            {editable && can(user.roles, "campaign:update") && (
              <Link
                href={`/campaigns/${campaign.id}/edit`}
                className={buttonClass.secondary}
              >
                Edit
              </Link>
            )}

            {canStart && editable && (
              <form action={startCampaign}>
                <input type="hidden" name="id" value={campaign.id} />
                <button type="submit" className={buttonClass.primary}>
                  Start now
                </button>
              </form>
            )}

            {canStop && campaign.status === "RUNNING" && (
              <>
                <form action={setCampaignStatus}>
                  <input type="hidden" name="id" value={campaign.id} />
                  <input type="hidden" name="status" value="PAUSED" />
                  <button type="submit" className={buttonClass.secondary}>
                    Pause
                  </button>
                </form>
                <form action={setCampaignStatus}>
                  <input type="hidden" name="id" value={campaign.id} />
                  <input type="hidden" name="status" value="STOPPED" />
                  <button type="submit" className={buttonClass.danger}>
                    Stop
                  </button>
                </form>
              </>
            )}

            {canStart && campaign.status === "PAUSED" && (
              <form action={setCampaignStatus}>
                <input type="hidden" name="id" value={campaign.id} />
                <input type="hidden" name="status" value="RUNNING" />
                <button type="submit" className={buttonClass.secondary}>
                  Resume
                </button>
              </form>
            )}
          </div>
        }
      />

      {campaign.status === "STOPPED" && (
        <Card className="mb-4">
          <p role="status" className="font-medium">
            This campaign was stopped. No further sends are initiated, and it
            cannot be resumed — {pendingCount} audience member
            {pendingCount === 1 ? "" : "s"} were never messaged. Create a new
            campaign if the send should continue.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Audience" value={metrics.audience} />
        <StatTile label="Sent" value={metrics.sent} hint={`${pendingCount} not yet sent`} />
        <StatTile label="Delivered" value={metrics.delivered} />
        <StatTile label="Read" value={metrics.read} />
        <StatTile
          label="Replies"
          value={metrics.replies}
          hint={
            metrics.responseRate !== null
              ? `${(metrics.responseRate * 100).toFixed(1)}% of sent`
              : undefined
          }
        />
        <StatTile label="Failed" value={metrics.failed} />
        <StatTile label="Leads" value={metrics.leads} />
        <StatTile label="Calls" value={metrics.calls} />
        <StatTile label="Meetings" value={metrics.meetings} />
        <StatTile label="Conversions" value={metrics.conversions} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card
          title={showFailuresOnly ? "Failed deliveries" : "Deliveries"}
          actions={
            <div className="flex gap-2">
              <Link
                href={`/campaigns/${campaign.id}`}
                className={cx(
                  buttonClass.secondary,
                  !showFailuresOnly && "font-medium",
                )}
              >
                All
              </Link>
              <Link
                href={{ pathname: `/campaigns/${campaign.id}`, query: { failures: "1" } }}
                className={cx(buttonClass.secondary, showFailuresOnly && "font-medium")}
              >
                Failures ({metrics.failed})
              </Link>
            </div>
          }
        >
          {deliveries.length === 0 ? (
            <EmptyState
              title={showFailuresOnly ? "No failures" : "Nothing sent yet"}
              description={
                showFailuresOnly
                  ? "Every delivery so far was accepted by the provider."
                  : "Deliveries appear here once the campaign starts."
              }
            />
          ) : (
            <Table
              caption="Deliveries"
              head={["Customer", "Status", "Sent", "Delivered", "Read", "Replied", "Result"]}
            >
              {deliveries.map((d) => (
                <Row key={d.id}>
                  <Cell>
                    <Link
                      href={`/customers/${d.customer.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {d.customer.name}
                    </Link>
                    <p className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {d.customer.phoneE164}
                    </p>
                  </Cell>
                  <Cell>
                    <Badge tone={statusTone(d.status)}>{titleCase(d.status)}</Badge>
                  </Cell>
                  <Cell>{d.sentAt?.toLocaleString() ?? "—"}</Cell>
                  <Cell>{d.deliveredAt?.toLocaleString() ?? "—"}</Cell>
                  <Cell>{d.readAt?.toLocaleString() ?? "—"}</Cell>
                  <Cell>{d.repliedAt?.toLocaleString() ?? "—"}</Cell>
                  <Cell className="text-[length:var(--text-small)]">
                    {d.result ?? "—"}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Configuration">
            <dl className="flex flex-col gap-3 text-[length:var(--text-small)]">
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Template</dt>
                <dd>
                  <Link
                    href={{ pathname: "/templates", query: { edit: campaign.template.id } }}
                    className="underline-offset-2 hover:underline"
                  >
                    {campaign.template.category} — {campaign.template.name}
                  </Link>
                  <p className="mt-1 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[color:var(--color-surface-muted)] p-2">
                    {campaign.template.body}
                  </p>
                </dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Scheduled</dt>
                <dd>{campaign.scheduledAt?.toLocaleString() ?? "Not scheduled"}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Started</dt>
                <dd>{campaign.startedAt?.toLocaleString() ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Completed</dt>
                <dd>{campaign.completedAt?.toLocaleString() ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Created by</dt>
                <dd>{campaign.createdBy.displayName}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--color-text-secondary)]">Result</dt>
                {/* Doc 12 §7 — the canonical result taxonomy is TBD. */}
                <dd>Not defined</dd>
              </div>
            </dl>
          </Card>

          <Card title="Audience definition">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[length:var(--text-small)]">
              {describeSegment(segment).map((part, i) => (
                <li key={i}>{part}</li>
              ))}
            </ul>
            <p className="mt-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              {campaign.startedAt
                ? `Frozen at launch — ${metrics.audience} customers. Later customer changes do not alter this list.`
                : "Not yet frozen. The audience resolves when the campaign starts."}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
