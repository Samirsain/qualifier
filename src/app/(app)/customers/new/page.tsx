import { CustomerForm } from "./form";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Manual customer entry (BR-04 "Manual Entry" source, F-001). */
export default async function NewCustomerPage() {
  await requirePermission("customer:create");

  const sources = await prisma.source.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });

  return (
    <>
      <PageHeader
        title="Add customer"
        description="Source is required — every customer must carry a clearly visible origin."
      />
      <Card className="max-w-2xl">
        <CustomerForm sources={sources} />
      </Card>
    </>
  );
}
