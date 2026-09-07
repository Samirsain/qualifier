import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Escape a CSV field. A name containing a comma or quote must not shift columns. */
function csv(value: string | null | undefined): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(request: NextRequest) {
  const user = await requirePermission("qualified:export");

  const unexportedOnly = request.nextUrl.searchParams.get("new") === "1";
  const batchId = request.nextUrl.searchParams.get("batch");

  const rows = await prisma.customer.findMany({
    where: {
      status: "QUALIFIED",
      ...(unexportedOnly && { exportedAt: null }),
      ...(batchId && { batchId }),
    },
    orderBy: { qualifiedAt: "asc" },
    include: { batch: { select: { name: true, automation: { select: { name: true } } } } },
  });

  const header = "name,phone,qualified_at,batch,funnel";
  const body = rows
    .map((r) =>
      [
        csv(r.name),
        csv(r.phoneE164),
        csv(r.qualifiedAt?.toISOString() ?? ""),
        csv(r.batch?.name ?? ""),
        csv(r.batch?.automation.name ?? ""),
      ].join(","),
    )
    .join("\n");

  // Stamp what left the building, so the next export can exclude it and the
  // CRM team never receives the same number twice.
  if (rows.length > 0) {
    await prisma.customer.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { exportedAt: new Date() },
    });
    await logActivity({
      actorUserId: user.id,
      eventType: "qualified.exported",
      objectType: "export",
      metadata: { count: rows.length, unexportedOnly, batchId },
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qualified-${stamp}.csv"`,
    },
  });
}
