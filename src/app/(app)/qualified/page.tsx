import Link from "next/link";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  FilterChip,
  PageHeader,
  Row,
  Table,
  buttonClass,
} from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { relativeTime } from "@/lib/relative-time";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The output of the whole system: the numbers that asked to be contacted.
 *
 * Export stamps `exportedAt`, so "not yet exported" is the working list and
 * the CRM team is never handed the same number twice — which is why the
 * primary action is "export the new ones", not "export everything".
 */
export default async function QualifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; new?: string }>;
}) {
  const user = await requirePermission("qualified:read");
  const canExport = can(user.roles, "qualified:export");
  const filters = await searchParams;

  const batchFilter = filters.batch && filters.batch !== "" ? filters.batch : undefined;
  const view = filters.new === "0" ? "exported" : filters.new === "" ? "all" : "new";

  const where = {
    status: "QUALIFIED" as const,
    ...(batchFilter && { batchId: batchFilter }),
    ...(view === "new" && { exportedAt: null }),
    ...(view === "exported" && { exportedAt: { not: null } }),
  };

  const [rows, batches, total, exported, lastExport] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { qualifiedAt: "desc" },
      take: 500,
      include: {
        batch: { select: { id: true, name: true, automation: { select: { name: true } } } },
      },
    }),
    prisma.batch.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.customer.count({ where: { status: "QUALIFIED" } }),
    prisma.customer.count({ where: { status: "QUALIFIED", exportedAt: { not: null } } }),
    prisma.customer.findFirst({
      where: { exportedAt: { not: null } },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true },
    }),
  ]);

  const waiting = total - exported;
  const exportQuery = new URLSearchParams();
  if (batchFilter) exportQuery.set("batch", batchFilter);

  const viewHref = (next: "new" | "all" | "exported") => {
    const params = new URLSearchParams();
    if (batchFilter) params.set("batch", batchFilter);
    if (next === "all") params.set("new", "");
    if (next === "exported") params.set("new", "0");
    const query = params.toString();
    return query ? `/qualified?${query}` : "/qualified";
  };

  return (
    <>
      <PageHeader
        title="Qualified"
        description="Numbers that asked to be contacted. Hand these to the CRM team — nothing else in this system needs to happen to them."
        actions={
          canExport && (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/qualified/export?${exportQuery}`}
                className={buttonClass.secondary}
              >
                Export all {total}
              </a>
              <a
                href={`/api/qualified/export?${new URLSearchParams({
                  ...Object.fromEntries(exportQuery),
                  new: "1",
                })}`}
                className={buttonClass.primary}
              >
                Export {waiting} new
              </a>
            </div>
          )
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Waiting to be exported
            </span>
            <span className="text-[length:var(--text-h2)] font-semibold tabular-nums text-[color:var(--color-status-success)]">
              {waiting}
            </span>
          </div>
          <div className="h-10 w-px bg-[color:var(--color-border-default)]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Already handed over
            </span>
            <span className="text-[length:var(--text-h2)] font-semibold tabular-nums">
              {exported}
            </span>
          </div>
          <div className="h-10 w-px bg-[color:var(--color-border-default)]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Last export
            </span>
            <span className="font-medium">
              {lastExport?.exportedAt
                ? formatDateTime(lastExport.exportedAt)
                : "Never exported"}
            </span>
          </div>
          <p className="ml-auto max-w-xs text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            Every export stamps its rows, so “new” never hands the CRM team the
            same number twice.
          </p>
        </div>
      </Card>

      <Card
        title="Qualified numbers"
        flush={rows.length > 0}
        footer={
          rows.length > 0 ? (
            <span>
              Showing {rows.length} of {total} qualified number
              {total === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <FilterChip
              href={viewHref("new")}
              label="New"
              count={waiting}
              active={view === "new"}
            />
            <FilterChip
              href={viewHref("all")}
              label="All"
              count={total}
              active={view === "all"}
            />
            <FilterChip
              href={viewHref("exported")}
              label="Exported"
              count={exported}
              active={view === "exported"}
            />
            <form method="get" className="flex items-center gap-2">
              {view !== "all" && (
                <input type="hidden" name="new" value={view === "new" ? "1" : "0"} />
              )}
              <select
                name="batch"
                defaultValue={batchFilter ?? ""}
                className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] px-2 py-1 text-[length:var(--text-small)]"
              >
                <option value="">All batches</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClass.secondary}>
                Apply
              </button>
            </form>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={
              view === "new" && total > 0
                ? "Everything qualified so far has been handed over"
                : "Nothing qualified yet"
            }
            description={
              view === "new" && total > 0
                ? "New numbers appear here the moment a funnel qualifies them."
                : "Numbers appear here the moment a funnel reaches its Mark qualified step."
            }
            action={
              view !== "all" && total > 0 ? (
                <Link href={viewHref("all")} className={buttonClass.secondary}>
                  Show all {total}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table
            head={["Number", "Qualified", "From batch", "Funnel", "Handover"]}
          >
            {rows.map((r) => (
              <Row key={r.id}>
                <Cell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-[family-name:var(--font-mono)]">
                      {r.phoneE164}
                    </span>
                    <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {r.name ?? "—"}
                    </span>
                  </div>
                </Cell>
                <Cell>
                  {r.qualifiedAt ? (
                    <div className="flex flex-col gap-0.5">
                      <span>{relativeTime(r.qualifiedAt)}</span>
                      <span className="text-[length:var(--text-small)] tabular-nums text-[color:var(--color-text-secondary)]">
                        {formatDateTime(r.qualifiedAt)}
                      </span>
                    </div>
                  ) : (
                    "—"
                  )}
                </Cell>
                <Cell>
                  {r.batch ? (
                    <Link
                      href={`/batches/${r.batch.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.batch.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Cell>
                <Cell>{r.batch?.automation.name ?? "—"}</Cell>
                <Cell>
                  {r.exportedAt ? (
                    <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      Exported {formatDate(r.exportedAt)}
                    </span>
                  ) : (
                    <Badge tone="success" dot>
                      Not exported yet
                    </Badge>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
