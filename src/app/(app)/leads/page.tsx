import Link from "next/link";
import { moveLeadStage } from "./actions";
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
  inputClass,
} from "@/components/ui";
import {
  INTEREST_STATUS_LABELS,
  interestTone,
  type InterestStatusKey,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can, customerScope } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * UI-007 — Lead Pipeline. Ten source-defined stages, counts per stage, and
 * stage updates that always write history (BR-24).
 */
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const user = await requirePermission("lead:read");
  const params = await searchParams;

  const stageCode = typeof params.stage === "string" ? params.stage : "";
  const scope = customerScope(user.roles, user.id);

  const stages = await prisma.leadStage.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  const where: Prisma.LeadWhereInput = {
    customer: scope,
    ...(stageCode && { stage: { code: stageCode } }),
  };

  const [leads, counts] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        stage: true,
        assignedStaff: { select: { displayName: true } },
        customer: {
          select: {
            id: true,
            name: true,
            phoneE164: true,
            nextFollowUpAt: true,
            source: { select: { name: true } },
          },
        },
      },
    }),
    prisma.lead.groupBy({
      by: ["stageId"],
      where: { customer: scope },
      _count: { _all: true },
    }),
  ]);

  const countByStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
  const canUpdate = can(user.roles, "lead:update");

  return (
    <>
      <PageHeader
        title="Leads"
        description="The ten-stage pipeline. Every stage change is recorded with who moved it and when."
      />

      <Card className="mb-4" title="Pipeline">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/leads"
              className={cx(
                "block rounded-[var(--radius-sm)] border px-3 py-2",
                stageCode === ""
                  ? "border-[color:var(--color-action-primary)] bg-[color:var(--color-action-primary)] text-white"
                  : "border-[color:var(--color-border-default)]",
              )}
            >
              All <span className="tabular-nums">{leads.length > 0 || stageCode ? [...countByStage.values()].reduce((a, b) => a + b, 0) : 0}</span>
            </Link>
          </li>
          {stages.map((s) => (
            <li key={s.id}>
              <Link
                href={{ pathname: "/leads", query: { stage: s.code } }}
                aria-current={stageCode === s.code ? "page" : undefined}
                className={cx(
                  "block rounded-[var(--radius-sm)] border px-3 py-2",
                  stageCode === s.code
                    ? "border-[color:var(--color-action-primary)] bg-[color:var(--color-action-primary)] text-white"
                    : "border-[color:var(--color-border-default)]",
                )}
              >
                {s.name}{" "}
                <span className="tabular-nums font-medium">
                  {countByStage.get(s.id) ?? 0}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        {leads.length === 0 ? (
          <EmptyState
            title={stageCode ? "No leads in this stage" : "No leads yet"}
            description="A lead record is created for a customer once they enter the pipeline."
            action={
              stageCode && (
                <Link href="/leads" className={buttonClass.secondary}>
                  Show all stages
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption="Leads"
            head={[
              "Customer",
              "Source",
              "Stage",
              "Interest",
              "Owner",
              "Next follow-up",
              ...(canUpdate ? ["Move to"] : []),
            ]}
          >
            {leads.map((lead) => (
              <Row key={lead.id}>
                <Cell>
                  <Link
                    href={`/customers/${lead.customer.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {lead.customer.name}
                  </Link>
                  <p className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                    {lead.customer.phoneE164}
                  </p>
                </Cell>
                <Cell>{lead.customer.source.name}</Cell>
                <Cell>
                  <Badge>{lead.stage.name}</Badge>
                </Cell>
                <Cell>
                  <Badge tone={interestTone(lead.interestStatus)}>
                    {INTEREST_STATUS_LABELS[lead.interestStatus as InterestStatusKey]}
                  </Badge>
                </Cell>
                <Cell>{lead.assignedStaff?.displayName ?? "Unassigned"}</Cell>
                <Cell>{lead.customer.nextFollowUpAt?.toLocaleDateString() ?? "—"}</Cell>
                {canUpdate && (
                  <Cell>
                    <form action={moveLeadStage} className="flex gap-2">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <select
                        name="stageId"
                        defaultValue={lead.stageId}
                        className={inputClass}
                        aria-label={`Stage for ${lead.customer.name}`}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={buttonClass.secondary}>
                        Move
                      </button>
                    </form>
                  </Cell>
                )}
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
