import Link from "next/link";
import { setConversationStatus } from "./actions";
import { Composer } from "./composer";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonClass,
  cx,
  inputClass,
} from "@/components/ui";
import { statusTone, titleCase } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * UI-003 — WhatsApp Inbox. Three panes: conversation list, thread, customer
 * context. Reply, template send, status, assignment and close/reopen (BR-07).
 */
export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await requirePermission("conversation:read");
  const params = await searchParams;

  const selectedId = typeof params.customer === "string" ? params.customer : null;
  const filter = typeof params.filter === "string" ? params.filter : "open";
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const where: Prisma.ConversationWhereInput = {
    customer: {
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phoneE164: { contains: q } },
        ],
      }),
    },
    ...(filter === "open" && { status: "OPEN" }),
    ...(filter === "unread" && { unreadCount: { gt: 0 } }),
    ...(filter === "closed" && { status: "CLOSED" }),
  };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 60,
    include: {
      customer: {
        select: { id: true, name: true, phoneE164: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true, createdAt: true },
      },
    },
  });

  const active =
    conversations.find((c) => c.customer.id === selectedId) ?? conversations[0];

  const [thread, templates] = active
    ? await Promise.all([
        prisma.message.findMany({
          where: { conversationId: active.id },
          orderBy: { createdAt: "asc" },
          take: 200,
        }),
        can(user.roles, "template:read")
          ? prisma.template.findMany({
              where: { active: true, archivedAt: null },
              orderBy: { name: "asc" },
              select: { id: true, name: true, category: true },
            })
          : Promise.resolve([]),
      ])
    : [[], []];

  const customer = active
    ? await prisma.customer.findUnique({
        where: { id: active.customer.id },
        include: {
          source: { select: { name: true } },
          assignedStaff: { select: { displayName: true } },
          lead: { include: { stage: { select: { name: true } } } },
          followUps: {
            where: { status: "PENDING" },
            orderBy: { dueAt: "asc" },
            take: 3,
          },
        },
      })
    : null;

  const filterLink = (value: string) => ({
    pathname: "/inbox" as const,
    query: { filter: value, ...(q && { q }) },
  });

  return (
    <>
      <PageHeader
        title="WhatsApp Inbox"
        description="Every customer conversation, with the context needed to answer it."
      />

      {conversations.length === 0 && !q && filter === "open" ? (
        <Card>
          <EmptyState
            title="No open conversations"
            description="Conversations appear here when a customer messages you, or when a campaign or automation starts one."
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[20rem_1fr_18rem]">
          {/* Pane 1 — conversation list */}
          <Card className="min-w-0">
            <form className="mb-3 flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Name or phone"
                className={inputClass}
                aria-label="Search conversations"
              />
              <input type="hidden" name="filter" value={filter} />
              <button type="submit" className={buttonClass.secondary}>
                Go
              </button>
            </form>

            <nav aria-label="Conversation filters" className="mb-3 flex gap-2">
              {["open", "unread", "closed", "all"].map((value) => (
                <Link
                  key={value}
                  href={filterLink(value)}
                  aria-current={filter === value ? "true" : undefined}
                  className={cx(
                    "rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-small)]",
                    filter === value
                      ? "bg-[color:var(--color-action-primary)] text-white"
                      : "border border-[color:var(--color-border-default)]",
                  )}
                >
                  {titleCase(value)}
                </Link>
              ))}
            </nav>

            {conversations.length === 0 ? (
              <EmptyState
                title="Nothing matches"
                description="Try a different filter or clear the search."
              />
            ) : (
              <ul className="flex max-h-[32rem] flex-col overflow-y-auto">
                {conversations.map((c) => {
                  const last = c.messages[0];
                  const isActive = active?.id === c.id;
                  return (
                    <li key={c.id}>
                      <Link
                        href={{ pathname: "/inbox", query: { customer: c.customer.id, filter } }}
                        className={cx(
                          "block border-b border-[color:var(--color-border-default)] px-2 py-3 last:border-0",
                          isActive
                            ? "bg-[color:var(--color-surface-muted)]"
                            : "hover:bg-[color:var(--color-surface-muted)]",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{c.customer.name}</span>
                          {c.unreadCount > 0 && (
                            <Badge tone="info">{c.unreadCount} unread</Badge>
                          )}
                        </div>
                        <p className="truncate text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          {last
                            ? `${last.direction === "INBOUND" ? "" : "You: "}${last.body ?? ""}`
                            : "No messages yet"}
                        </p>
                        <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          {c.lastMessageAt?.toLocaleString() ?? ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Pane 2 — thread */}
          <Card
            className="min-w-0"
            title={active ? active.customer.name : "Conversation"}
            actions={
              active &&
              can(user.roles, "conversation:reply") && (
                <form action={setConversationStatus}>
                  <input type="hidden" name="conversationId" value={active.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={active.status === "OPEN" ? "CLOSED" : "OPEN"}
                  />
                  <button type="submit" className={buttonClass.secondary}>
                    {active.status === "OPEN" ? "Close conversation" : "Reopen"}
                  </button>
                </form>
              )
            }
          >
            {!active ? (
              <EmptyState title="Select a conversation" />
            ) : (
              <>
                <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1">
                  {thread.length === 0 ? (
                    <EmptyState
                      title="No messages yet"
                      description="Start the conversation with an approved template."
                    />
                  ) : (
                    thread.map((m) => (
                      <div
                        key={m.id}
                        className={cx(
                          "max-w-[80%] rounded-[var(--radius-md)] border px-3 py-2",
                          m.direction === "INBOUND"
                            ? "self-start border-[color:var(--color-border-default)] bg-[color:var(--color-surface-muted)]"
                            : "self-end border-[color:var(--color-action-primary)]",
                        )}
                      >
                        <p className="break-words whitespace-pre-wrap">{m.body}</p>
                        <div className="mt-1 flex items-center gap-2 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          <time dateTime={m.createdAt.toISOString()}>
                            {m.createdAt.toLocaleString()}
                          </time>
                          {m.direction === "OUTBOUND" && (
                            <Badge tone={statusTone(m.deliveryStatus)}>
                              {titleCase(m.deliveryStatus)}
                            </Badge>
                          )}
                        </div>
                        {m.failureCode && (
                          <p className="mt-1 text-[length:var(--text-small)] text-[color:var(--color-status-error)]">
                            Provider error {m.failureCode}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {can(user.roles, "conversation:reply") && (
                  <div className="mt-4 border-t border-[color:var(--color-border-default)] pt-4">
                    <Composer
                      customerId={active.customer.id}
                      templates={templates}
                      disabled={active.status === "CLOSED"}
                    />
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Pane 3 — customer context */}
          <Card title="Customer" className="min-w-0">
            {!customer ? (
              <EmptyState title="No customer selected" />
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {customer.name}
                  </Link>
                  <p className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                    {customer.phoneE164}
                  </p>
                </div>

                <dl className="flex flex-col gap-2 text-[length:var(--text-small)]">
                  <Fact label="Source">{customer.source.name}</Fact>
                  <Fact label="Lead stage">{customer.lead?.stage.name ?? "—"}</Fact>
                  <Fact label="Owner">
                    {customer.assignedStaff?.displayName ?? "Unassigned"}
                  </Fact>
                  <Fact label="Next follow-up">
                    {customer.followUps[0]?.dueAt.toLocaleString() ?? "None scheduled"}
                  </Fact>
                </dl>

                {customer.optedOutAt && (
                  <Badge tone="error">Opted out — do not message</Badge>
                )}

                <Link
                  href={`/customers/${customer.id}`}
                  className={buttonClass.secondary}
                >
                  Open full history
                </Link>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[color:var(--color-text-secondary)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
