import Link from "next/link";
import { UploadForm } from "./upload-form";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewBatchPage() {
  await requirePermission("batch:manage");

  const funnels = await prisma.automation.findMany({
    where: { status: "ACTIVE", archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, version: true },
  });

  return (
    <>
      <PageHeader
        title="Upload numbers"
        description="Paste or load a list, check what it contains, then send it through a live funnel."
        actions={
          <Link href="/batches" className="underline-offset-2 hover:underline">
            All batches
          </Link>
        }
      />
      <UploadForm funnels={funnels} />
    </>
  );
}
