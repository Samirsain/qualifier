import Link from "next/link";
import { setFaqActive } from "./actions";
import { FaqEditor } from "./editor";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/** UI-017 — FAQ. Categories, entries, search and activation (BR-12). */
export default async function FaqPage({ searchParams }: PageProps<"/faq">) {
  const user = await requirePermission("faq:read");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const editingId = typeof params.edit === "string" ? params.edit : null;

  const where: Prisma.FaqWhereInput = q
    ? {
        OR: [
          { question: { contains: q, mode: "insensitive" } },
          { answer: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [faqs, editing] = await Promise.all([
    prisma.faq.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    }),
    editingId ? prisma.faq.findUnique({ where: { id: editingId } }) : Promise.resolve(null),
  ]);

  const manage = can(user.roles, "faq:manage");

  const byCategory = new Map<string, typeof faqs>();
  for (const faq of faqs) {
    const list = byCategory.get(faq.category) ?? [];
    list.push(faq);
    byCategory.set(faq.category, list);
  }

  return (
    <>
      <PageHeader
        title="FAQ"
        description="Consistent answers to common questions, reusable inside customer journeys."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <form className="flex items-end gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-[length:var(--text-small)] font-medium">
                  Search
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  className={inputClass}
                  placeholder="Question, answer or category"
                />
              </label>
              <button type="submit" className={buttonClass.secondary}>
                Search
              </button>
              {q && (
                <Link href="/faq" className={buttonClass.secondary}>
                  Clear
                </Link>
              )}
            </form>
          </Card>

          {faqs.length === 0 ? (
            <Card>
              <EmptyState
                title={q ? "No FAQs match" : "No FAQs yet"}
                description={
                  manage
                    ? "Add the first entry with the editor."
                    : "A manager or admin maintains the FAQ library."
                }
              />
            </Card>
          ) : (
            [...byCategory.entries()].map(([category, entries]) => (
              <Card key={category} title={category}>
                <ul className="flex flex-col gap-4">
                  {entries.map((faq) => (
                    <li
                      key={faq.id}
                      className="border-b border-[color:var(--color-border-default)] pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="font-medium">{faq.question}</p>
                        <Badge tone={faq.active ? "success" : "neutral"}>
                          {faq.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[color:var(--color-text-secondary)]">
                        {faq.answer}
                      </p>
                      {manage && (
                        <div className="mt-2 flex gap-2">
                          <Link
                            href={{ pathname: "/faq", query: { edit: faq.id } }}
                            className={buttonClass.secondary}
                          >
                            Edit
                          </Link>
                          <form action={setFaqActive}>
                            <input type="hidden" name="id" value={faq.id} />
                            <input
                              type="hidden"
                              name="active"
                              value={faq.active ? "false" : "true"}
                            />
                            <button type="submit" className={buttonClass.secondary}>
                              {faq.active ? "Deactivate" : "Activate"}
                            </button>
                          </form>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>

        {manage && (
          <Card title={editing ? "Edit FAQ" : "New FAQ"}>
            <FaqEditor key={editing?.id ?? "new"} faq={editing} />
          </Card>
        )}
      </div>
    </>
  );
}
