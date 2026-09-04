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

const PAGE_SIZE = 25;

/**
 * UI-004 — Customer List. Name, phone, source, campaign, staff, lead stage,
 * interest status, next follow-up, last interaction (BR-41 search + filters).
 */
export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  const user = await requirePermission("customer:read");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const interest = typeof params.interest === "string" ? params.interest : "";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const where: Prisma.CustomerWhereInput = {
    ...customerScope(user.roles, user.id),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phoneE164: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(interest in INTEREST_STATUS_LABELS && {
      interestStatus: interest as InterestStatusKey,
    }),
  };

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        source: { select: { name: true } },
        campaign: { select: { name: true } },
        assignedStaff: { select: { displayName: true } },
        lead: { include: { stage: { select: { name: true } } } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${total} customer${total === 1 ? "" : "s"} visible to you.`}
        actions={
          can(user.roles, "customer:create") && (
            <Link href="/customers/new" className={buttonClass.primary}>
              Add customer
            </Link>
          )
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Search
            </span>
            <input
              className={inputClass}
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Name, phone, email or location"
            />
          </label>
          <label>
            <span className="mb-1 block text-[length:var(--text-small)] font-medium">
              Interest status
            </span>
            <select className={inputClass} name="interest" defaultValue={interest}>
              <option value="">All</option>
              {Object.entries(INTEREST_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            Apply filters
          </button>
          {(q || interest) && (
            <Link href="/customers" className={buttonClass.secondary}>
              Clear
            </Link>
          )}
        </form>
      </Card>

      <Card>
        {customers.length === 0 ? (
          <EmptyState
            title={q || interest ? "No customers match these filters" : "No customers yet"}
            description={
              q || interest
                ? "Clear the filters to see the full list you have access to."
                : "Customers appear here once they arrive from a campaign, a form, or manual entry."
            }
            action={
              (q || interest) && (
                <Link href="/customers" className={buttonClass.secondary}>
                  Clear filters
                </Link>
              )
            }
          />
        ) : (
          <>
            <Table
              caption="Customers"
              head={[
                "Name",
                "Phone",
                "Source",
                "Campaign",
                "Owner",
                "Lead stage",
                "Interest",
                "Next follow-up",
                "Last interaction",
              ]}
            >
              {customers.map((c) => (
                <Row key={c.id}>
                  <Cell>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </Cell>
                  <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                    {c.phoneE164}
                  </Cell>
                  <Cell>{c.source.name}</Cell>
                  <Cell>{c.campaign?.name ?? c.sourceDetail ?? "—"}</Cell>
                  <Cell>{c.assignedStaff?.displayName ?? "Unassigned"}</Cell>
                  <Cell>{c.lead?.stage.name ?? "—"}</Cell>
                  <Cell>
                    <Badge tone={interestTone(c.interestStatus)}>
                      {INTEREST_STATUS_LABELS[c.interestStatus as InterestStatusKey]}
                    </Badge>
                  </Cell>
                  <Cell>{c.nextFollowUpAt?.toLocaleDateString() ?? "—"}</Cell>
                  <Cell>{c.lastInteractionAt?.toLocaleString() ?? "—"}</Cell>
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
                      href={{ pathname: "/customers", query: { q, interest, page: page - 1 } }}
                    >
                      Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link
                      className={buttonClass.secondary}
                      href={{ pathname: "/customers", query: { q, interest, page: page + 1 } }}
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
