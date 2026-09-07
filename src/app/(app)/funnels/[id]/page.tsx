import Link from "next/link";
import { notFound } from "next/navigation";
import { Builder } from "./builder";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AUTOMATION_STATUS_LABELS, statusTone } from "@/lib/labels";
import { validateAutomation } from "@/lib/automation/validate";
import { fromEngineSteps } from "@/lib/funnels/steps";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The builder edits the current version's steps. Validation is re-run on load
 * so the reasons a funnel cannot go live are visible before anyone presses
 * Activate, rather than only as a rejection afterwards.
 */
export default async function FunnelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("funnel:read");
  const { id } = await params;

  const funnel = await prisma.automation.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, version: true, description: true },
  });
  if (!funnel) notFound();

  const [rows, templates, problems] = await Promise.all([
    prisma.automationStep.findMany({
      where: { automationId: id, version: funnel.version },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.template.findMany({
      where: { active: true, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    validateAutomation(id),
  ]);

  const steps = fromEngineSteps(
    rows.map((r) => ({
      stepKey: r.stepKey,
      stepType: r.stepType as "ACTION" | "WAIT" | "BRANCH",
      config: r.config,
      nextStepKey: r.nextStepKey,
      sortOrder: r.sortOrder,
    })),
  );

  return (
    <>
      <PageHeader
        title={funnel.name}
        description={funnel.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(funnel.status)}>
              {AUTOMATION_STATUS_LABELS[funnel.status]}
            </Badge>
            <Badge>Version {funnel.version}</Badge>
            <Link href="/funnels" className="underline-offset-2 hover:underline">
              All funnels
            </Link>
          </div>
        }
      />

      {problems.length > 0 && (
        <Card title="Not ready to go live" className="mb-4">
          <ul className="list-disc space-y-1 pl-6 text-[color:var(--color-status-error)]">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      {templates.length === 0 && (
        <Card className="mb-4">
          <p role="alert">
            There are no active templates yet. Add one under{" "}
            <Link href="/templates" className="underline">
              Templates
            </Link>{" "}
            before a message step can send anything.
          </p>
        </Card>
      )}

      <Builder
        id={funnel.id}
        name={funnel.name}
        steps={steps}
        templates={templates}
        status={funnel.status}
      />
    </>
  );
}
