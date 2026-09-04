import Link from "next/link";
import { duplicateTemplate, setTemplateArchived } from "./actions";
import { TemplateEditor } from "./editor";
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
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * UI-015 Templates + UI-016 Template Editor (BR-22, BR-23).
 * Usage visibility is the `template_usages` count, so management can see
 * where each template is used and how often.
 */
export default async function TemplatesPage({
  searchParams,
}: PageProps<"/templates">) {
  const user = await requirePermission("template:read");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const category = typeof params.category === "string" ? params.category : "";
  const showArchived = params.archived === "1";
  const editingId = typeof params.edit === "string" ? params.edit : null;

  const where: Prisma.TemplateWhereInput = {
    ...(showArchived ? {} : { archivedAt: null }),
    ...(category && { category }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [templates, categories, editing] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { _count: { select: { usages: true } } },
    }),
    prisma.template.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    editingId
      ? prisma.template.findUnique({ where: { id: editingId } })
      : Promise.resolve(null),
  ]);

  const manage = can(user.roles, "template:manage");

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable, categorised messages for campaigns and automations."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <form className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1">
                <span className="mb-1 block text-[length:var(--text-small)] font-medium">
                  Search
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  className={inputClass}
                  placeholder="Name or body text"
                />
              </label>
              <label>
                <span className="mb-1 block text-[length:var(--text-small)] font-medium">
                  Category
                </span>
                <select name="category" defaultValue={category} className={inputClass}>
                  <option value="">All</option>
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  name="archived"
                  value="1"
                  defaultChecked={showArchived}
                />
                <span className="text-[length:var(--text-small)]">
                  Include archived
                </span>
              </label>
              <button type="submit" className={buttonClass.secondary}>
                Apply
              </button>
            </form>
          </Card>

          <Card>
            {templates.length === 0 ? (
              <EmptyState
                title={q || category ? "No templates match" : "No templates yet"}
                description={
                  manage
                    ? "Create one with the editor on the right."
                    : "A manager or admin creates templates."
                }
              />
            ) : (
              <Table
                caption="Templates"
                head={[
                  "Name",
                  "Category",
                  "Provider key",
                  "Approval",
                  "Used",
                  "State",
                  ...(manage ? ["Actions"] : []),
                ]}
              >
                {templates.map((t) => (
                  <Row key={t.id}>
                    <Cell>
                      <span className="font-medium">{t.name}</span>
                      <p className="max-w-md truncate text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                        {t.body}
                      </p>
                    </Cell>
                    <Cell>{t.category}</Cell>
                    <Cell className="font-[family-name:var(--font-mono)] text-[length:var(--text-small)]">
                      {t.providerTemplateKey ?? "—"}
                    </Cell>
                    <Cell>
                      {/* GAP-027: lifecycle states are provider/business defined. */}
                      {t.approvalStatus ?? "Not recorded"}
                    </Cell>
                    <Cell className="tabular-nums">{t._count.usages}</Cell>
                    <Cell>
                      {t.archivedAt ? (
                        <Badge tone="neutral">Archived</Badge>
                      ) : t.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="warning">Inactive</Badge>
                      )}
                    </Cell>
                    {manage && (
                      <Cell>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={{ pathname: "/templates", query: { edit: t.id } }}
                            className={buttonClass.secondary}
                          >
                            Edit
                          </Link>
                          <form action={duplicateTemplate}>
                            <input type="hidden" name="id" value={t.id} />
                            <button type="submit" className={buttonClass.secondary}>
                              Duplicate
                            </button>
                          </form>
                          <form action={setTemplateArchived}>
                            <input type="hidden" name="id" value={t.id} />
                            <input
                              type="hidden"
                              name="archived"
                              value={t.archivedAt ? "false" : "true"}
                            />
                            <button type="submit" className={buttonClass.secondary}>
                              {t.archivedAt ? "Restore" : "Archive"}
                            </button>
                          </form>
                        </div>
                      </Cell>
                    )}
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {manage && (
          <Card title={editing ? "Edit template" : "New template"}>
            <TemplateEditor key={editing?.id ?? "new"} template={editing} />
          </Card>
        )}
      </div>
    </>
  );
}
