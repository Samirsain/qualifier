import Link from "next/link";
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
  inputClass,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The output of the whole system: the numbers that asked to be contacted.
 *
 * Export stamps `exportedAt`, so "not yet exported" is the working list and
 * the CRM team is never handed the same number twice.
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
  const newOnly = filters.new === "1";

  const where = {
    status: "QUALIFIED" as const,
    ...(batchFilter && { batchId: batchFilter }),
    ...(newOnly && { exportedAt: null }),
  };

  const [rows, batches, total, exported] = await Promise.all([
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
  ]);

  const exportQuery = new URLSearchParams();
  if (batchFilter) exportQuery.set("batch", batchFilter);

  return (
    <>
      <PageHeader
        title="Qualified"
        description="Numbers that asked to be contacted. Hand these to the CRM team."
        actions={
          canExport && (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/qualified/export?${new URLSearchParams({
                  ...Object.fromEntries(exportQuery),
                  new: "1",
                })}`}
                className={buttonClass.primary}
              >
                Export new only
              </a>
              <a
                href={`/api/qualified/export?${exportQuery}`}
                className={buttonClass.secondary}
              >
                Export all
              </a>
            </div>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label="Qualified" value={total} />
        <StatTile label="Already exported" value={exported} />
        <StatTile label="Not yet exported" value={total - exported} />
      </div>

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Batch
            </span>
            <select name="batch" defaultValue={batchFilter ?? ""} className={inputClass}>
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="new" value="1" defaultChecked={newOnly} />
            <span>Not yet exported</span>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Apply
          </button>
          {(batchFilter || newOnly) && (
            <Link href="/qualified" className="underline-offset-2 hover:underline">
              Clear
            </Link>
          )}
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing qualified yet"
            description="Numbers appear here the moment a funnel reaches its Mark qualified step."
          />
        ) : (
          <Table
            caption="Qualified numbers"
            head={["Number", "Name", "Qualified", "Batch", "Funnel", "Exported"]}
          >
            {rows.map((r) => (
              <Row key={r.id}>
                <Cell className="font-[family-name:var(--font-mono)]">{r.phoneE164}</Cell>
                <Cell>{r.name ?? "—"}</Cell>
                <Cell>{r.qualifiedAt?.toLocaleString() ?? "—"}</Cell>
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
                    <Badge tone="success">{r.exportedAt.toLocaleDateString()}</Badge>
                  ) : (
                    <Badge tone="info">Not yet</Badge>
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
