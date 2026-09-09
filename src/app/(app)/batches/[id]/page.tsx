import Link from "next/link";
import { notFound } from "next/navigation";
import { setBatchStatus, startBatchAction } from "../actions";
import {
  Badge,
  Card,
  FilterChip,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  StepMeter,
  Table,
  buttonClass,
  cx,
} from "@/components/ui";
import { batchProgress } from "@/lib/batches/runner";
import { formatDate, formatDateTime } from "@/lib/format";
import { stepLabels } from "@/lib/funnels/step-labels";
import type { EngineStepRow } from "@/lib/funnels/steps";
import {
  BATCH_STATUS_LABELS,
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABELS,
  type CustomerStatusKey,
  statusTone,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { relativeTime } from "@/lib/relative-time";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const ORDER: CustomerStatusKey[] = [
  "NOT_STARTED",
  "IN_FUNNEL",
  "QUALIFIED",
  "NOT_INTERESTED",
  "NO_RESPONSE",
];

/**
 * One batch: how far it has got, and who is where.
 *
 * The six counts ARE the filter — they used to be repeated as a second row of
 * chips, so the same five numbers were read twice and neither row looked
 * clickable. Skipped is counted separately from "not started", because a
 * number that was never messaged is a different question from one that has
 * simply not been reached yet.
 */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await requirePermission("batch:read");
  const canManage = can(user.roles, "batch:manage");
  const { id } = await params;
  const { status: filter, q } = await searchParams;
  const search = q?.trim() ?? "";

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      automation: { select: { id: true, name: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  if (!batch) notFound();

  const memberWhere = {
    batchId: id,
    // Skipped numbers are their own filter, never mixed into a status view.
    ...(filter === "SKIPPED"
      ? { skippedReason: { not: null } }
      : filter
        ? { skippedReason: null }
        : {}),
    customer: {
      ...(filter && filter !== "SKIPPED" && { status: filter as CustomerStatusKey }),
      // One box for "find this number", matching either half of the column.
      ...(search && {
        OR: [
          { phoneE164: { contains: search } },
          { name: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    },
  };

  const [progress, members, total, skipped, pending, stepRows] = await Promise.all([
    batchProgress(id),
    prisma.batchMember.findMany({
      where: memberWhere,
      orderBy: [{ enrolledAt: "asc" }],
      take: 500,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneE164: true,
            status: true,
            lastInteractionAt: true,
          },
        },
      },
    }),
    prisma.batchMember.count({ where: { batchId: id } }),
    prisma.batchMember.count({ where: { batchId: id, skippedReason: { not: null } } }),
    prisma.batchMember.count({
      where: { batchId: id, enrolledAt: null, skippedReason: null },
    }),
    // The frozen version this batch runs, so the labels match what was sent.
    prisma.automationStep.findMany({
      where: { automationId: batch.automationId, version: batch.automationVersion },
      select: {
        stepKey: true,
        stepType: true,
        config: true,
        nextStepKey: true,
        sortOrder: true,
      },
    }),
  ]);

  const templateIds = [
    ...new Set(
      stepRows
        .map((row) => (row.config as { templateId?: string })?.templateId)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const templates = templateIds.length
    ? await prisma.template.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, name: true },
      })
    : [];
  const labels = stepLabels(
    stepRows as EngineStepRow[],
    new Map(templates.map((t) => [t.id, t.name])),
  );

  // Latest run per number: where that number has actually reached.
  const runs = members.length
    ? await prisma.automationRun.findMany({
        where: {
          automationId: batch.automationId,
          customerId: { in: members.map((m) => m.customerId) },
        },
        orderBy: { enteredAt: "desc" },
        select: {
          id: true,
          customerId: true,
          state: true,
          currentStepKey: true,
          nextActionAt: true,
          stopReason: true,
        },
      })
    : [];
  const runByCustomer = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!runByCustomer.has(run.customerId)) runByCustomer.set(run.customerId, run);
  }

  /*
   * Which steps each number has actually been through. One query for the whole
   * page rather than one per row — the events are the record of what happened,
   * so a step counts as done when it has an event, not when the position
   * suggests it should have.
   */
  const events = runByCustomer.size
    ? await prisma.automationEvent.findMany({
        where: { runId: { in: [...runByCustomer.values()].map((r) => r.id) } },
        orderBy: { occurredAt: "asc" },
        select: { runId: true, stepKey: true, occurredAt: true },
      })
    : [];
  const doneByRun = new Map<string, Map<string, Date>>();
  for (const event of events) {
    if (!event.stepKey) continue;
    const forRun = doneByRun.get(event.runId) ?? new Map<string, Date>();
    if (!forRun.has(event.stepKey)) forRun.set(event.stepKey, event.occurredAt);
    doneByRun.set(event.runId, forRun);
  }
  const funnelSteps = [...labels.entries()].map(([key, label]) => ({ key, ...label }));

  // A skipped number keeps the status it was created with, so without this it
  // would be counted twice: once as "not started", once as skipped.
  const counts: Record<string, number> = {
    ...progress,
    NOT_STARTED: (progress.NOT_STARTED ?? 0) - skipped,
    SKIPPED: skipped,
  };
  const qualified = counts.QUALIFIED ?? 0;
  const lastActivity = members
    .map((m) => m.customer.lastInteractionAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const href = (value?: string) => {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    if (search) params.set("q", search);
    const query = params.toString();
    return query ? `/batches/${id}?${query}` : `/batches/${id}`;
  };

  const cells: { key: string; label: string; color: string }[] = [
    ...ORDER.map((key) => ({
      key,
      label: CUSTOMER_STATUS_LABELS[key],
      color: CUSTOMER_STATUS_COLOR[key],
    })),
    ...(skipped > 0
      ? [{ key: "SKIPPED", label: "Skipped", color: "var(--color-text-secondary)" }]
      : []),
  ];

  return (
    <>
      <Link
        href="/batches"
        className="mb-3 inline-flex items-center gap-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)] underline-offset-2 hover:underline"
      >
        ← All batches
      </Link>

      <PageHeader
        title={batch.name}
        description={`${batch.automation.name} v${batch.automationVersion}, frozen at upload · uploaded by ${batch.createdBy.displayName} · ${formatDate(batch.createdAt)} · ${total} numbers`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(batch.status)} dot>
              {BATCH_STATUS_LABELS[batch.status]}
            </Badge>
            {canManage && (
              <>
                {batch.status === "DRAFT" && (
                  <form action={startBatchAction}>
                    <input type="hidden" name="id" value={batch.id} />
                    <button type="submit" className={buttonClass.primary}>
                      Start batch
                    </button>
                  </form>
                )}
                {batch.status === "RUNNING" && (
                  <form action={setBatchStatus}>
                    <input type="hidden" name="id" value={batch.id} />
                    <input type="hidden" name="status" value="PAUSED" />
                    <button type="submit" className={buttonClass.secondary}>
                      Pause
                    </button>
                  </form>
                )}
                {batch.status === "PAUSED" && (
                  <form action={setBatchStatus}>
                    <input type="hidden" name="id" value={batch.id} />
                    <input type="hidden" name="status" value="RUNNING" />
                    <button type="submit" className={buttonClass.primary}>
                      Resume batch
                    </button>
                  </form>
                )}
                {(batch.status === "RUNNING" || batch.status === "PAUSED") && (
                  <form action={setBatchStatus}>
                    <input type="hidden" name="id" value={batch.id} />
                    <input type="hidden" name="status" value="STOPPED" />
                    <button type="submit" className={buttonClass.danger}>
                      Stop enrolling
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        }
      />

      {/*
        Each count sits under its own slice of the bar, and the slice is as
        wide as its share — so the colour, the number and the label are one
        column and nothing has to be matched up by eye. Filtering lives in the
        row underneath: the figures report, the chips act.
      */}
      <section className="mb-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[length:var(--text-h3)] font-semibold tracking-tight">
            Where the {total} number{total === 1 ? "" : "s"} stand
          </h2>
          <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            {pending > 0 && <>{pending} still to enrol</>}
            {pending > 0 && lastActivity ? " · " : ""}
            {lastActivity && <>last activity {relativeTime(lastActivity)}</>}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-5">
          {cells.map((cell) => {
            const value = counts[cell.key] ?? 0;
            return (
              <div
                key={cell.key}
                className="flex min-w-28 flex-col gap-2"
                style={{ flexGrow: value, flexBasis: 0 }}
              >
                <span
                  aria-hidden
                  className="h-1.5 rounded-full"
                  style={{ background: cell.color }}
                />
                <span className="flex items-baseline gap-1.5">
                  <span
                    className="text-[length:var(--text-h1)] leading-none font-semibold tracking-tight tabular-nums"
                    style={
                      cell.key === "QUALIFIED"
                        ? { color: "var(--color-status-success)" }
                        : undefined
                    }
                  >
                    {value}
                  </span>
                  {cell.key === "QUALIFIED" && total > 0 && (
                    <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {Math.round((qualified / total) * 100)}%
                    </span>
                  )}
                </span>
                <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                  {cell.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[color:var(--color-border-default)] pt-4">
          <span className="mr-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            Show
          </span>
          <FilterChip href={href()} label="All" count={total} active={!filter} />
          {cells.map((cell) => (
            <FilterChip
              key={cell.key}
              href={href(cell.key)}
              label={cell.label}
              count={counts[cell.key] ?? 0}
              active={filter === cell.key}
            />
          ))}
        </div>
      </section>

      <Card
        title={
          filter
            ? `${cells.find((c) => c.key === filter)?.label ?? "Filtered"} numbers`
            : "Numbers in this batch"
        }
        flush
        footer={
          <>
            <span>
              Showing {members.length} of {total} number{total === 1 ? "" : "s"}
            </span>
            {members.length === 500 && <span>First 500 shown.</span>}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(filter || search) && (
              <Link
                href={href()}
                className="text-[length:var(--text-small)] underline-offset-2 hover:underline"
              >
                Clear filter
              </Link>
            )}
            <form method="get" className="flex items-center gap-2">
              {filter && <input type="hidden" name="status" value={filter} />}
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Search a number or name"
                aria-label="Search a number or name"
                className="w-60 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-2.5 py-1.5 text-[length:var(--text-small)] placeholder:text-[color:var(--color-text-secondary)]"
              />
              <button type="submit" className={buttonClass.secondary}>
                Search
              </button>
            </form>
          </div>
        }
      >
        {members.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                filter || search
                  ? "Nothing matches this filter"
                  : "This batch has no numbers."
              }
              action={
                (filter || search) && (
                  <Link href={href()} className={buttonClass.secondary}>
                    Show all {total}
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <Table head={["Number", "Status", "Where it is", "When"]}>
            {members.map((m) => {
              const run = runByCustomer.get(m.customerId);
              const step = run?.currentStepKey
                ? labels.get(run.currentStepKey)
                : undefined;
              const status = m.customer.status;
              const done = (run && doneByRun.get(run.id)) ?? new Map<string, Date>();

              /*
               * One sentence per row. "Where it is" used to say the same thing
               * as the Status badge in different words, and a number that had
               * finished still reported "Stopped — ...", which is the wording
               * for a dead end rather than for the outcome you wanted.
               */
              const where = m.skippedReason
                ? `Skipped — ${m.skippedReason}`
                : !m.enrolledAt
                  ? "Waiting to enrol"
                  : !run
                    ? "Not in a funnel run"
                    : status === "QUALIFIED"
                      ? "Finished — asked to be contacted"
                      : run.state === "COMPLETED"
                        ? "Finished the funnel"
                        : run.state === "STOPPED"
                          ? `Stopped — ${run.stopReason ?? "no reason recorded"}`
                          : run.state === "WAITING" && step
                            ? // The sentence already says it is a question.
                              `Waiting for a reply — “${step.label.replace(/^Question: /, "")}”`
                            : (step?.label ?? run.state.toLowerCase());

              /*
               * One time column, not two half-empty ones: a number that is
               * still moving is read forwards (when does it fire), a number
               * that has finished is read backwards (when did it last move).
               */
              const when = run?.nextActionAt
                ? {
                    relative: relativeTime(run.nextActionAt),
                    exact: `next · ${formatDateTime(run.nextActionAt)}`,
                  }
                : m.customer.lastInteractionAt
                  ? {
                      relative: relativeTime(m.customer.lastInteractionAt),
                      exact: `last · ${formatDateTime(m.customer.lastInteractionAt)}`,
                    }
                  : null;

              return (
                <Row key={m.customerId}>
                  <Cell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-[family-name:var(--font-mono)]">
                        {m.customer.phoneE164}
                      </span>
                      {m.customer.name && (
                        <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                          {m.customer.name}
                        </span>
                      )}
                    </div>
                  </Cell>

                  <Cell>
                    {m.skippedReason ? (
                      <Badge>Skipped</Badge>
                    ) : (
                      <Badge tone={statusTone(status)} dot>
                        {CUSTOMER_STATUS_LABELS[status]}
                      </Badge>
                    )}
                  </Cell>

                  <Cell className="w-[46%]">
                    {done.size === 0 ? (
                      <span
                        className={cx(
                          "line-clamp-1",
                          (m.skippedReason || !m.enrolledAt) &&
                            "text-[color:var(--color-text-secondary)]",
                        )}
                        title={where}
                      >
                        {where}
                      </span>
                    ) : (
                      // Open it to see the steps this number actually went
                      // through, and when. No script: <details> is the control.
                      <details className="group">
                        <summary className="flex cursor-pointer list-none flex-col gap-1.5">
                          <span className="line-clamp-1" title={where}>
                            {where}
                          </span>
                          <span className="flex items-center gap-2">
                            <StepMeter
                              done={done.size}
                              total={funnelSteps.length}
                              color={CUSTOMER_STATUS_COLOR[status as CustomerStatusKey]}
                            />
                            <span className="text-[length:var(--text-small)] tabular-nums text-[color:var(--color-text-secondary)]">
                              {done.size} of {funnelSteps.length} steps
                            </span>
                            <span className="text-[length:var(--text-small)] text-[color:var(--color-action-primary)] underline-offset-2 group-hover:underline">
                              {"Show steps"}
                            </span>
                          </span>
                        </summary>

                        {/*
                          Only the steps this number actually went through. The
                          funnel branches three ways at the end, so listing all
                          nine put "Stop: not interested" and "Stop: no reply"
                          under a qualified number as if they were still coming.
                          What is left over is one honest line, not a list.
                        */}
                        <ol className="mt-3 grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-2 border-l border-[color:var(--color-border-default)] py-1 pl-4">
                          {funnelSteps
                            .filter((funnelStep) => done.has(funnelStep.key))
                            .map((funnelStep) => (
                              <li
                                key={funnelStep.key}
                                className="col-span-3 grid grid-cols-subgrid items-baseline"
                              >
                                <span className="relative text-[length:var(--text-small)] tabular-nums text-[color:var(--color-text-secondary)]">
                                  <span
                                    aria-hidden
                                    className="absolute top-1.5 -left-[21px] h-1.5 w-1.5 rounded-full"
                                    style={{
                                      background:
                                        CUSTOMER_STATUS_COLOR[status as CustomerStatusKey],
                                    }}
                                  />
                                  {funnelStep.index}
                                </span>
                                <span className="text-[length:var(--text-small)]">
                                  {funnelStep.label}
                                </span>
                                <span className="text-[length:var(--text-small)] tabular-nums whitespace-nowrap text-[color:var(--color-text-secondary)]">
                                  {formatDateTime(done.get(funnelStep.key)!)}
                                </span>
                              </li>
                            ))}

                          {funnelSteps.length > done.size && (
                            <li className="col-span-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                              {funnelSteps.length - done.size} more step
                              {funnelSteps.length - done.size === 1 ? "" : "s"} in this
                              funnel —{" "}
                              {run && (run.state === "STOPPED" || run.state === "COMPLETED")
                                ? "not taken"
                                : "not reached yet"}
                            </li>
                          )}
                        </ol>
                      </details>
                    )}
                  </Cell>

                  <Cell>
                    {when ? (
                      <div className="flex flex-col gap-0.5">
                        <span>{when.relative}</span>
                        <span className="text-[length:var(--text-small)] tabular-nums text-[color:var(--color-text-secondary)]">
                          {when.exact}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[color:var(--color-text-secondary)]">—</span>
                    )}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
