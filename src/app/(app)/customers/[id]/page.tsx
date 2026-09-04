import Link from "next/link";
import { notFound } from "next/navigation";
import { assignCustomer, updateInterestStatus } from "../actions";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
  inputClass,
} from "@/components/ui";
import {
  INTEREST_STATUS_LABELS,
  interestTone,
  statusTone,
  titleCase,
  type InterestStatusKey,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can, customerScope } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

type TimelineEntry = {
  at: Date;
  kind: string;
  tone: "neutral" | "success" | "warning" | "error" | "info";
  title: string;
  detail?: string | null;
};

/**
 * UI-005 Customer Profile + UI-006 Customer 360 View (BR-05, BR-06, BR-11).
 * One page: contact/source/CRM fields, owner, follow-up, and the chronological
 * 360 timeline that merges messages, responses, stage changes, calls,
 * meetings, follow-ups and automation runs.
 */
export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const user = await requirePermission("customer:read");
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, ...customerScope(user.roles, user.id) },
    include: {
      source: true,
      campaign: { select: { id: true, name: true } },
      assignedStaff: { select: { id: true, displayName: true } },
      tags: { include: { tag: true } },
      lead: { include: { stage: true, history: { include: { toStage: true }, orderBy: { changedAt: "desc" } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 50 },
      responses: { orderBy: { receivedAt: "desc" }, take: 50 },
      followUps: {
        orderBy: { dueAt: "desc" },
        include: { assignedStaff: { select: { displayName: true } } },
      },
      calls: { orderBy: { requestedAt: "desc" } },
      meetings: { orderBy: { requestedAt: "desc" } },
      runs: { orderBy: { enteredAt: "desc" }, include: { automation: { select: { name: true } } } },
    },
  });

  if (!customer) notFound();

  const staff = can(user.roles, "customer:assign")
    ? await prisma.user.findMany({
        where: { status: "ACTIVE", userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } } },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      })
    : [];

  // 360 timeline — one chronological stream across every relationship.
  const timeline: TimelineEntry[] = [
    ...customer.messages.map((m) => ({
      at: m.createdAt,
      kind: m.direction === "INBOUND" ? "Message in" : "Message out",
      tone: statusTone(m.deliveryStatus),
      title: m.body?.slice(0, 200) ?? titleCase(m.type),
      detail: `${titleCase(m.deliveryStatus)}`,
    })),
    ...customer.responses.map((r) => ({
      at: r.receivedAt,
      kind: "Response",
      tone: "info" as const,
      title: `${r.questionKey}: ${r.response}`,
      detail: r.result,
    })),
    ...(customer.lead?.history ?? []).map((h) => ({
      at: h.changedAt,
      kind: "Lead stage",
      tone: "neutral" as const,
      title: `Moved to ${h.toStage.name}`,
      detail: h.note,
    })),
    ...customer.followUps.map((f) => ({
      at: f.createdAt,
      kind: "Follow-up",
      tone: statusTone(f.status),
      title: `${f.type} — due ${f.dueAt.toLocaleDateString()}`,
      detail: `${titleCase(f.status)} · ${f.assignedStaff.displayName}`,
    })),
    ...customer.calls.map((c) => ({
      at: c.requestedAt,
      kind: "Call request",
      tone: statusTone(c.status),
      title: c.requirement,
      detail: titleCase(c.status),
    })),
    ...customer.meetings.map((m) => ({
      at: m.requestedAt,
      kind: "Meeting request",
      tone: "neutral" as const,
      title: m.requirement,
      detail: m.meetingStatus,
    })),
    ...customer.runs.map((r) => ({
      at: r.enteredAt,
      kind: "Automation",
      tone: statusTone(r.state),
      title: r.automation.name,
      detail: `${titleCase(r.state)}${r.stopReason ? ` · ${r.stopReason}` : ""}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const canUpdate = can(user.roles, "customer:update");

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.phoneE164}${customer.location ? ` · ${customer.location}` : ""}`}
        actions={
          <Link href={`/inbox?customer=${customer.id}`} className={buttonClass.secondary}>
            Open conversation
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card title="Customer">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <Detail label="Source">{customer.source.name}</Detail>
              <Detail label="Source detail">
                {customer.campaign ? (
                  <Link href={`/campaigns/${customer.campaign.id}`} className="underline-offset-2 hover:underline">
                    {customer.campaign.name}
                  </Link>
                ) : (
                  (customer.sourceDetail ?? "—")
                )}
              </Detail>
              <Detail label="Email">{customer.email ?? "—"}</Detail>
              <Detail label="Interest">
                <Badge tone={interestTone(customer.interestStatus)}>
                  {INTEREST_STATUS_LABELS[customer.interestStatus as InterestStatusKey]}
                </Badge>
              </Detail>
              <Detail label="Lead stage">{customer.lead?.stage.name ?? "—"}</Detail>
              <Detail label="Owner">{customer.assignedStaff?.displayName ?? "Unassigned"}</Detail>
              <Detail label="Next follow-up">
                {customer.nextFollowUpAt?.toLocaleString() ?? "—"}
              </Detail>
              <Detail label="Last interaction">
                {customer.lastInteractionAt?.toLocaleString() ?? "—"}
              </Detail>
              <Detail label="Customer type">
                {/* GAP-032 — taxonomy not defined by the business source. */}
                {customer.customerType ?? "Not defined"}
              </Detail>
              <Detail label="Outcome">
                {/* GAP-008 — outcome taxonomy is a pending business decision. */}
                {customer.outcome ?? "Not defined"}
              </Detail>
            </dl>

            {customer.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {customer.tags.map((t) => (
                  <Badge key={t.tagId}>{t.tag.name}</Badge>
                ))}
              </div>
            )}
          </Card>

          {canUpdate && (
            <Card title="Interest status">
              <form action={updateInterestStatus} className="flex flex-col gap-3">
                <input type="hidden" name="customerId" value={customer.id} />
                <select
                  name="interestStatus"
                  defaultValue={customer.interestStatus}
                  className={inputClass}
                  aria-label="Interest status"
                >
                  {Object.entries(INTEREST_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="submit" className={buttonClass.primary}>
                  Update interest
                </button>
              </form>
            </Card>
          )}

          {can(user.roles, "customer:assign") && (
            <Card title="Assignment">
              <form action={assignCustomer} className="flex flex-col gap-3">
                <input type="hidden" name="customerId" value={customer.id} />
                <select
                  name="staffId"
                  defaultValue={customer.assignedStaffId ?? ""}
                  className={inputClass}
                  aria-label="Assigned staff"
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                    </option>
                  ))}
                </select>
                <input
                  name="reason"
                  className={inputClass}
                  placeholder="Reason (optional)"
                  aria-label="Assignment reason"
                />
                <button type="submit" className={buttonClass.primary}>
                  Save assignment
                </button>
              </form>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Customer 360 timeline">
            {timeline.length === 0 ? (
              <EmptyState
                title="No recorded activity"
                description="Messages, responses, stage changes, follow-ups, calls, meetings and automation runs appear here as they happen."
              />
            ) : (
              <ol className="flex flex-col">
                {timeline.map((e, i) => (
                  <li
                    key={i}
                    className="flex gap-3 border-b border-[color:var(--color-border-default)] py-3 last:border-0"
                  >
                    <time
                      dateTime={e.at.toISOString()}
                      className="w-40 shrink-0 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)] tabular-nums"
                    >
                      {e.at.toLocaleString()}
                    </time>
                    <div className="min-w-0">
                      <Badge tone={e.tone}>{e.kind}</Badge>
                      <p className="mt-1 break-words">{e.title}</p>
                      {e.detail && (
                        <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          {e.detail}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Follow-ups">
            {customer.followUps.length === 0 ? (
              <EmptyState title="No follow-ups" description="Create one from the Follow-ups module." />
            ) : (
              <Table head={["Type", "Due", "Status", "Owner", "Notes"]} caption="Follow-ups">
                {customer.followUps.map((f) => (
                  <Row key={f.id}>
                    <Cell>{f.type}</Cell>
                    <Cell>{f.dueAt.toLocaleString()}</Cell>
                    <Cell>
                      <Badge tone={statusTone(f.status)}>{titleCase(f.status)}</Badge>
                    </Cell>
                    <Cell>{f.assignedStaff.displayName}</Cell>
                    <Cell>{f.notes ?? "—"}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
