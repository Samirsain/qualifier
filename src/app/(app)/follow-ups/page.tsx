import Link from "next/link";
import { completeFollowUp, rescheduleFollowUp, updateCallStatus } from "./actions";
import { NewFollowUpForm } from "./form";
import { assignRequest, updateMeeting } from "./request-actions";
import { RequestForm } from "./request-forms";
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
import { CALL_STATUS_LABELS, statusTone, titleCase } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can, customerScope } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const TABS = ["today", "upcoming", "overdue", "completed", "calls", "meetings"] as const;

/**
 * UI-008 — Follow-ups (BR-26) plus call and meeting queues (BR-27, BR-28).
 *
 * GAP-014 — the escalation SLA is undecided, so "overdue" means only "past
 * its due time and still pending". No escalation threshold is invented.
 */
export default async function FollowUpsPage({
  searchParams,
}: PageProps<"/follow-ups">) {
  const user = await requirePermission("followup:read");
  const params = await searchParams;

  const tab = (
    TABS.includes(params.tab as (typeof TABS)[number]) ? params.tab : "today"
  ) as (typeof TABS)[number];

  const scope = customerScope(user.roles, user.id);
  const ownScope = can(user.roles, "customer:read_all")
    ? {}
    : { assignedStaffId: user.id };

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const rangeFor: Record<string, Prisma.FollowUpWhereInput> = {
    today: { status: "PENDING", dueAt: { gte: startOfToday, lt: endOfToday } },
    upcoming: { status: "PENDING", dueAt: { gte: endOfToday } },
    overdue: { status: "PENDING", dueAt: { lt: startOfToday } },
    completed: { status: { in: ["COMPLETED", "RESCHEDULED"] } },
  };

  const isFollowUpTab = tab in rangeFor;

  const [followUps, calls, meetings, counts, customers, staff] = await Promise.all([
    isFollowUpTab
      ? prisma.followUp.findMany({
          where: { ...rangeFor[tab], ...ownScope },
          orderBy: { dueAt: tab === "completed" ? "desc" : "asc" },
          take: 100,
          include: {
            customer: { select: { id: true, name: true, phoneE164: true } },
            assignedStaff: { select: { displayName: true } },
          },
        })
      : Promise.resolve([]),
    tab === "calls"
      ? prisma.call.findMany({
          where: { customer: scope },
          orderBy: { requestedAt: "desc" },
          take: 100,
          include: {
            customer: { select: { id: true, name: true, phoneE164: true } },
            assignedStaff: { select: { displayName: true } },
            source: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    tab === "meetings"
      ? prisma.meeting.findMany({
          where: { customer: scope },
          orderBy: { requestedAt: "desc" },
          take: 100,
          include: {
            customer: { select: { id: true, name: true } },
            assignedStaff: { select: { displayName: true } },
          },
        })
      : Promise.resolve([]),
    Promise.all(
      (["today", "upcoming", "overdue"] as const).map((key) =>
        prisma.followUp.count({ where: { ...rangeFor[key], ...ownScope } }),
      ),
    ),
    can(user.roles, "followup:manage") ||
    can(user.roles, "call:manage") ||
    can(user.roles, "meeting:manage")
      ? prisma.customer.findMany({
          where: scope,
          orderBy: { name: "asc" },
          take: 200,
          select: { id: true, name: true, phoneE164: true },
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } },
      },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
  ]);

  const [todayCount, upcomingCount, overdueCount] = counts;
  const manage = can(user.roles, "followup:manage");

  const tabLabel: Record<(typeof TABS)[number], string> = {
    today: `Today (${todayCount})`,
    upcoming: `Upcoming (${upcomingCount})`,
    overdue: `Overdue (${overdueCount})`,
    completed: "Completed",
    calls: "Call requests",
    meetings: "Meeting requests",
  };

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Today, upcoming, overdue and completed work, plus customer call and meeting requests."
      />

      <nav aria-label="Follow-up views" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((value) => (
          <Link
            key={value}
            href={{ pathname: "/follow-ups", query: { tab: value } }}
            aria-current={tab === value ? "page" : undefined}
            className={cx(
              "rounded-[var(--radius-sm)] border px-3 py-2",
              tab === value
                ? "border-[color:var(--color-action-primary)] bg-[color:var(--color-action-primary)] text-white"
                : "border-[color:var(--color-border-default)]",
            )}
          >
            {tabLabel[value]}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card className="min-w-0">
          {tab === "calls" ? (
            calls.length === 0 ? (
              <EmptyState
                title="No call requests"
                description="A call request is created when a customer asks to be called."
              />
            ) : (
              <Table
                caption="Call requests"
                head={[
                  "Customer",
                  "Requirement",
                  "Source",
                  "Owner",
                  "Requested",
                  "Status",
                  ...(can(user.roles, "call:manage") ? ["Update"] : []),
                ]}
              >
                {calls.map((c) => (
                  <Row key={c.id}>
                    <Cell>
                      <Link
                        href={`/customers/${c.customer.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.customer.name}
                      </Link>
                    </Cell>
                    <Cell>{c.requirement}</Cell>
                    <Cell>{c.source?.name ?? "—"}</Cell>
                    <Cell>{c.assignedStaff?.displayName ?? "Unassigned"}</Cell>
                    <Cell>{c.requestedAt.toLocaleString()}</Cell>
                    <Cell>
                      <Badge tone={statusTone(c.status)}>
                        {CALL_STATUS_LABELS[c.status]}
                      </Badge>
                    </Cell>
                    {can(user.roles, "call:manage") && (
                      <Cell>
                        <div className="flex flex-col gap-2">
                          <form action={updateCallStatus} className="flex gap-2">
                            <input type="hidden" name="id" value={c.id} />
                            <select
                              name="status"
                              defaultValue={c.status}
                              className={inputClass}
                              aria-label={`Call status for ${c.customer.name}`}
                            >
                              {Object.entries(CALL_STATUS_LABELS).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className={buttonClass.secondary}>
                              Status
                            </button>
                          </form>
                          <form action={assignRequest} className="flex gap-2">
                            <input type="hidden" name="kind" value="call" />
                            <input type="hidden" name="id" value={c.id} />
                            <select
                              name="staffId"
                              defaultValue={c.assignedStaffId ?? ""}
                              className={inputClass}
                              aria-label={`Call owner for ${c.customer.name}`}
                            >
                              <option value="">Unassigned</option>
                              {staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.displayName}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className={buttonClass.secondary}>
                              Assign
                            </button>
                          </form>
                        </div>
                      </Cell>
                    )}
                  </Row>
                ))}
              </Table>
            )
          ) : tab === "meetings" ? (
            meetings.length === 0 ? (
              <EmptyState
                title="No meeting requests"
                description="A meeting request is created when a customer asks to meet."
              />
            ) : (
              <Table
                caption="Meeting requests"
                head={[
                  "Customer",
                  "Requirement",
                  "Owner",
                  "Requested",
                  "Scheduled",
                  "Status",
                  "Outcome",
                  ...(can(user.roles, "meeting:manage") ? ["Update"] : []),
                ]}
              >
                {meetings.map((m) => (
                  <Row key={m.id}>
                    <Cell>
                      <Link
                        href={`/customers/${m.customer.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {m.customer.name}
                      </Link>
                    </Cell>
                    <Cell>{m.requirement}</Cell>
                    <Cell>{m.assignedStaff?.displayName ?? "Unassigned"}</Cell>
                    <Cell>{m.requestedAt.toLocaleString()}</Cell>
                    <Cell>{m.scheduledAt?.toLocaleString() ?? "—"}</Cell>
                    {/* GAP-007 / GAP-008: taxonomies not defined by the source,
                        so these stay free text rather than a guessed dropdown. */}
                    <Cell>{m.meetingStatus}</Cell>
                    <Cell>{m.outcome ?? "Not defined"}</Cell>
                    {can(user.roles, "meeting:manage") && (
                      <Cell>
                        <div className="flex flex-col gap-2">
                          <form action={updateMeeting} className="flex flex-col gap-2">
                            <input type="hidden" name="id" value={m.id} />
                            <input
                              name="meetingStatus"
                              defaultValue={m.meetingStatus}
                              className={inputClass}
                              maxLength={60}
                              required
                              aria-label={`Meeting status for ${m.customer.name}`}
                            />
                            <input
                              name="outcome"
                              defaultValue={m.outcome ?? ""}
                              className={inputClass}
                              maxLength={200}
                              placeholder="Outcome"
                              aria-label={`Meeting outcome for ${m.customer.name}`}
                            />
                            <button type="submit" className={buttonClass.secondary}>
                              Save
                            </button>
                          </form>
                          <form action={assignRequest} className="flex gap-2">
                            <input type="hidden" name="kind" value="meeting" />
                            <input type="hidden" name="id" value={m.id} />
                            <select
                              name="staffId"
                              defaultValue={m.assignedStaffId ?? ""}
                              className={inputClass}
                              aria-label={`Meeting owner for ${m.customer.name}`}
                            >
                              <option value="">Unassigned</option>
                              {staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.displayName}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className={buttonClass.secondary}>
                              Assign
                            </button>
                          </form>
                        </div>
                      </Cell>
                    )}
                  </Row>
                ))}
              </Table>
            )
          ) : followUps.length === 0 ? (
            <EmptyState
              title={`Nothing ${tab === "completed" ? "completed yet" : `due ${tab}`}`}
              description={
                manage
                  ? "Create a follow-up with the form on the right."
                  : "Follow-ups assigned to you appear here."
              }
            />
          ) : (
            <Table
              caption={`Follow-ups — ${tab}`}
              head={[
                "Customer",
                "Type",
                "Due",
                "Owner",
                "Status",
                "Notes",
                ...(manage && tab !== "completed" ? ["Actions"] : []),
              ]}
            >
              {followUps.map((f) => {
                const overdue = f.status === "PENDING" && f.dueAt < startOfToday;
                return (
                  <Row key={f.id}>
                    <Cell>
                      <Link
                        href={`/customers/${f.customer.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {f.customer.name}
                      </Link>
                    </Cell>
                    <Cell>{f.type}</Cell>
                    <Cell>
                      <Badge tone={overdue ? "error" : statusTone(f.status)}>
                        {overdue ? "Overdue · " : ""}
                        {f.dueAt.toLocaleString()}
                      </Badge>
                    </Cell>
                    <Cell>{f.assignedStaff.displayName}</Cell>
                    <Cell>{titleCase(f.status)}</Cell>
                    <Cell>{f.notes ?? "—"}</Cell>
                    {manage && tab !== "completed" && (
                      <Cell>
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={completeFollowUp}>
                            <input type="hidden" name="id" value={f.id} />
                            <button type="submit" className={buttonClass.secondary}>
                              Complete
                            </button>
                          </form>
                          <form action={rescheduleFollowUp} className="flex gap-1">
                            <input type="hidden" name="id" value={f.id} />
                            <input
                              type="datetime-local"
                              name="dueAt"
                              required
                              className={inputClass}
                              aria-label={`New due date for ${f.customer.name}`}
                            />
                            <button type="submit" className={buttonClass.secondary}>
                              Reschedule
                            </button>
                          </form>
                        </div>
                      </Cell>
                    )}
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        {tab === "calls" ? (
          can(user.roles, "call:manage") && (
            <Card title="New call request">
              <RequestForm kind="call" customers={customers} staff={staff} />
            </Card>
          )
        ) : tab === "meetings" ? (
          can(user.roles, "meeting:manage") && (
            <Card title="New meeting request">
              <RequestForm kind="meeting" customers={customers} staff={staff} />
            </Card>
          )
        ) : (
          manage && (
            <Card title="New follow-up">
              <NewFollowUpForm customers={customers} staff={staff} />
            </Card>
          )
        )}
      </div>
    </>
  );
}
