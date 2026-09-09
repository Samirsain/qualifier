import Link from "next/link";
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
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Security-relevant events get a visible tone, so they stand out in the list. */
const SECURITY_EVENTS = [
  "auth.login",
  "auth.rate_limited",
  "authz.denied",
  "automation.pause_all",
  "automation.resume_all",
  "settings.changed",
  "staff_score.config_activated",
];

/**
 * UI-024 — Activity Log (F-021, BR-38; doc 11 §10 audit requirements).
 *
 * Read-only by design. An audit trail that can be edited from the product is
 * not an audit trail, so there is no delete or amend action anywhere.
 */
export default async function ActivityPage({
  searchParams,
}: PageProps<"/activity">) {
  await requirePermission("settings:read");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const objectType = typeof params.objectType === "string" ? params.objectType : "";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const where: Prisma.ActivityLogWhereInput = {
    ...(objectType && { objectType }),
    ...(q && {
      OR: [
        { eventType: { contains: q, mode: "insensitive" } },
        { objectType: { contains: q, mode: "insensitive" } },
        { actor: { displayName: { contains: q, mode: "insensitive" } } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    }),
  };

  const [entries, total, types] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        actor: { select: { displayName: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      distinct: ["objectType"],
      select: { objectType: true },
      orderBy: { objectType: "asc" },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Activity"
        description={`${total} recorded event${total === 1 ? "" : "s"}. This log is append-only and cannot be edited from the product.`}
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              className={inputClass}
              placeholder="Event, object, actor or customer"
            />
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Object type
            </span>
            <select name="objectType" defaultValue={objectType} className={inputClass}>
              <option value="">All</option>
              {types.map((t) => (
                <option key={t.objectType} value={t.objectType}>
                  {t.objectType}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Apply
          </button>
          {(q || objectType) && (
            <Link href="/activity" className={buttonClass.secondary}>
              Clear
            </Link>
          )}
        </form>
      </Card>

      <Card>
        {entries.length === 0 ? (
          <EmptyState
            title={q || objectType ? "No events match" : "No activity recorded yet"}
            description="Customer, status, automation and security events appear here as they happen."
          />
        ) : (
          <>
            <Table
              caption="Activity log"
              head={["When", "Event", "Actor", "Object", "Customer", "Detail"]}
            >
              {entries.map((e) => (
                <Row key={e.id}>
                  <Cell className="whitespace-nowrap tabular-nums">
                    <time dateTime={e.occurredAt.toISOString()}>
                      {formatDateTime(e.occurredAt)}
                    </time>
                  </Cell>
                  <Cell>
                    <Badge
                      tone={
                        e.eventType === "authz.denied" ||
                        e.eventType === "auth.rate_limited"
                          ? "error"
                          : SECURITY_EVENTS.includes(e.eventType)
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {e.eventType}
                    </Badge>
                  </Cell>
                  <Cell>{e.actor?.displayName ?? "System"}</Cell>
                  <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                    {e.objectType}
                  </Cell>
                  <Cell>{e.customer ? e.customer.name : "—"}</Cell>
                  <Cell>
                    {e.before || e.after ? (
                      <details>
                        <summary className="cursor-pointer text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          before / after
                        </summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--color-surface-muted)] p-2 text-[length:var(--text-small)]">
                          {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>

            {pages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-4 flex items-center justify-between gap-3"
              >
                <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      className={buttonClass.secondary}
                      href={{ pathname: "/activity", query: { q, objectType, page: page - 1 } }}
                    >
                      Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link
                      className={buttonClass.secondary}
                      href={{ pathname: "/activity", query: { q, objectType, page: page + 1 } }}
                    >
                      Next
                    </Link>
                  )}
                </div>
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
