import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonClass,
  cx,
  inputClass,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { stepLabels } from "@/lib/funnels/step-labels";
import type { EngineStepRow } from "@/lib/funnels/steps";
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABELS,
  type CustomerStatusKey,
  statusTone,
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { relativeTime } from "@/lib/relative-time";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const LIMIT = 300;

/**
 * One sheet for every number in a funnel: rows are numbers, columns are the
 * funnel's steps, and a cell says whether that number has been through that
 * step and when.
 *
 * The batch screen answers "how is this batch doing"; this answers the other
 * question — "of all the numbers running, who is stuck where" — without
 * opening each batch in turn. Columns come from the funnel's current version
 * and cells are matched by step key, so a batch frozen on an older version
 * still lines up wherever the keys are the same, and shows a blank column
 * where they are not.
 */
export default async function TrackingPage({
  searchParams,
}: PageProps<"/tracking">) {
  await requirePermission("batch:read");
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string).trim() : "";
  const search = one("q");
  const batchId = one("batch");
  const status = one("status");

  // Only funnels something actually runs on: an empty selector is noise.
  const funnels = await prisma.automation.findMany({
    where: { batches: { some: {} } },
    select: { id: true, name: true, version: true },
    orderBy: { updatedAt: "desc" },
  });

  if (funnels.length === 0) {
    return (
      <>
        <PageHeader
          title="Tracking"
          description="Every number in a funnel, side by side with the steps it has been through."
        />
        <Card>
          <EmptyState
            title="Nothing is running yet."
            action={
              <Link href="/batches/new" className={buttonClass.primary}>
                Upload numbers
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const funnel = funnels.find((f) => f.id === one("funnel")) ?? funnels[0];

  const [stepRows, batches] = await Promise.all([
    prisma.automationStep.findMany({
      where: { automationId: funnel.id, version: funnel.version },
      select: {
        stepKey: true,
        stepType: true,
        config: true,
        nextStepKey: true,
        sortOrder: true,
      },
    }),
    prisma.batch.findMany({
      where: { automationId: funnel.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
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
  const columns = [
    ...stepLabels(
      stepRows as EngineStepRow[],
      new Map(templates.map((t) => [t.id, t.name])),
    ).entries(),
  ].map(([key, label]) => ({ key, ...label }));

  const where = {
    batchMembers: {
      some: {
        batch: { automationId: funnel.id },
        ...(batchId && { batchId }),
      },
    },
    ...(status && { status: status as CustomerStatusKey }),
    ...(search && {
      OR: [
        { phoneE164: { contains: search } },
        { name: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      // The ones that moved most recently are the ones worth looking at.
      orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
      take: LIMIT,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        status: true,
        lastInteractionAt: true,
        batchMembers: {
          where: { batch: { automationId: funnel.id } },
          take: 1,
          select: {
            enrolledAt: true,
            skippedReason: true,
            batch: { select: { id: true, name: true } },
          },
        },
        runs: {
          where: { automationId: funnel.id },
          orderBy: { enteredAt: "desc" },
          take: 1,
          select: {
            id: true,
            state: true,
            currentStepKey: true,
            nextActionAt: true,
            stopReason: true,
          },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  // One query for the whole sheet: a step counts as done when it has an event,
  // never because the position suggests it should have happened.
  const runIds = rows.map((r) => r.runs[0]?.id).filter((id): id is string => Boolean(id));
  const events = runIds.length
    ? await prisma.automationEvent.findMany({
        where: { runId: { in: runIds } },
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

  const cell =
    "border-r border-b border-[color:var(--color-border-default)] px-3 py-2 align-middle";
  const stepCell = "w-14 min-w-14 text-center";

  return (
    <>
      <PageHeader
        title="Tracking"
        description="Every number in one sheet: a row per number, a column per step, and where each one has reached."
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] p-3"
      >
        <label className="flex flex-col gap-1 text-[length:var(--text-small)]">
          <span className="text-[color:var(--color-text-secondary)]">Funnel</span>
          <select name="funnel" defaultValue={funnel.id} className={inputClass}>
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[length:var(--text-small)]">
          <span className="text-[color:var(--color-text-secondary)]">Batch</span>
          <select name="batch" defaultValue={batchId} className={inputClass}>
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[length:var(--text-small)]">
          <span className="text-[color:var(--color-text-secondary)]">Status</span>
          <select name="status" defaultValue={status} className={inputClass}>
            <option value="">Any status</option>
            {Object.entries(CUSTOMER_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[length:var(--text-small)]">
          <span className="text-[color:var(--color-text-secondary)]">Find</span>
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Number or name"
            aria-label="Search a number or name"
            className={cx(inputClass, "w-56")}
          />
        </label>

        <button type="submit" className={buttonClass.secondary}>
          Apply
        </button>
        {(batchId || status || search) && (
          <Link
            href={`/tracking?funnel=${funnel.id}`}
            className="px-1 py-1.5 text-[length:var(--text-small)] underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      <Card
        title={`${funnel.name} · v${funnel.version}`}
        flush
        actions={
          <span className="flex flex-wrap items-center gap-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-[color:var(--color-status-success)]">
                ✓
              </span>
              done
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--color-action-primary)]/35"
                style={{ background: "var(--color-action-primary)" }}
              />
              here now
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden>·</span>
              not reached
            </span>
          </span>
        }
        footer={
          <>
            <span>
              Showing {rows.length} of {total} number{total === 1 ? "" : "s"}
            </span>
            {total > LIMIT && <span>First {LIMIT} shown — narrow it with a filter.</span>}
          </>
        }
      >
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                batchId || status || search
                  ? "Nothing matches this filter"
                  : "No numbers on this funnel yet."
              }
              action={
                (batchId || status || search) && (
                  <Link href={`/tracking?funnel=${funnel.id}`} className={buttonClass.secondary}>
                    Show all
                  </Link>
                )
              }
            />
          </div>
        ) : (
          /*
           * Sticky header and sticky first column, so the number stays
           * readable however far right the funnel runs — the sheet everyone
           * already knows how to read. Borders are per cell, not collapsed:
           * a collapsed border is painted by the table and disappears under a
           * sticky cell.
           */
          <div className="max-h-[70vh] overflow-auto">
            <table
              className="w-max text-left text-[length:var(--text-small)]"
              style={{ borderCollapse: "separate", borderSpacing: 0 }}
            >
              <caption className="sr-only">
                Numbers running {funnel.name}, and the steps each has been through
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className={cx(
                      cell,
                      "sticky top-0 left-0 z-30 min-w-56 bg-[color:var(--color-surface-muted)] font-semibold",
                    )}
                  >
                    Number
                  </th>
                  {["Batch", "Status"].map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className={cx(
                        cell,
                        "sticky top-0 z-20 bg-[color:var(--color-surface-muted)] font-semibold whitespace-nowrap",
                      )}
                    >
                      {head}
                    </th>
                  ))}
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      title={column.label}
                      className={cx(
                        cell,
                        stepCell,
                        "sticky top-0 z-20 bg-[color:var(--color-surface-muted)] font-semibold",
                      )}
                    >
                      <span className="tabular-nums">{column.index}</span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className={cx(
                      cell,
                      "sticky top-0 z-20 min-w-40 bg-[color:var(--color-surface-muted)] font-semibold whitespace-nowrap",
                    )}
                  >
                    Next / last
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const run = row.runs[0];
                  const member = row.batchMembers[0];
                  const done = (run && doneByRun.get(run.id)) ?? new Map<string, Date>();
                  const here =
                    run && run.state !== "COMPLETED" && run.state !== "STOPPED"
                      ? run.currentStepKey
                      : null;
                  const when = run?.nextActionAt
                    ? { label: relativeTime(run.nextActionAt), exact: `next · ${formatDateTime(run.nextActionAt)}` }
                    : row.lastInteractionAt
                      ? {
                          label: relativeTime(row.lastInteractionAt),
                          exact: `last · ${formatDateTime(row.lastInteractionAt)}`,
                        }
                      : null;

                  return (
                    <tr key={row.id} className="group">
                      <th
                        scope="row"
                        className={cx(
                          cell,
                          "sticky left-0 z-10 bg-[color:var(--color-surface)] font-normal group-hover:bg-[color:var(--color-surface-muted)]",
                        )}
                      >
                        <span className="font-[family-name:var(--font-mono)]">
                          {row.phoneE164}
                        </span>
                        {row.name && (
                          <span className="ml-2 text-[color:var(--color-text-secondary)]">
                            {row.name}
                          </span>
                        )}
                      </th>

                      <td className={cx(cell, "whitespace-nowrap")}>
                        {member?.batch ? (
                          <Link
                            href={`/batches/${member.batch.id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {member.batch.name}
                          </Link>
                        ) : (
                          <span className="text-[color:var(--color-text-secondary)]">—</span>
                        )}
                      </td>

                      <td className={cx(cell, "whitespace-nowrap")}>
                        {member?.skippedReason ? (
                          <Badge>Skipped</Badge>
                        ) : (
                          <Badge tone={statusTone(row.status)} dot>
                            {CUSTOMER_STATUS_LABELS[row.status as CustomerStatusKey]}
                          </Badge>
                        )}
                      </td>

                      {columns.map((column) => {
                        const at = done.get(column.key);
                        const current = here === column.key;
                        return (
                          <td
                            key={column.key}
                            className={cx(
                              cell,
                              stepCell,
                              current && "bg-[color:var(--color-action-primary)]/8",
                            )}
                            title={
                              at
                                ? `${column.label} · ${formatDateTime(at)}`
                                : current
                                  ? `${column.label} · here now`
                                  : column.label
                            }
                          >
                            {current ? (
                              <span
                                aria-label={`${column.label}: here now`}
                                className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--color-action-primary)]/35"
                                style={{ background: "var(--color-action-primary)" }}
                              />
                            ) : at ? (
                              <span
                                aria-label={`${column.label}: done`}
                                style={{
                                  color:
                                    CUSTOMER_STATUS_COLOR[row.status as CustomerStatusKey],
                                }}
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                aria-label={`${column.label}: not reached`}
                                className="text-[color:var(--color-border-default)]"
                              >
                                ·
                              </span>
                            )}
                          </td>
                        );
                      })}

                      <td className={cx(cell, "whitespace-nowrap")}>
                        {when ? (
                          <span title={when.exact}>{when.label}</span>
                        ) : (
                          <span className="text-[color:var(--color-text-secondary)]">
                            {member?.enrolledAt ? "—" : "waiting to enrol"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* The column headers are numbers so the grid stays narrow; this is the key. */}
      <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
        {columns.map((column) => (
          <li key={column.key}>
            <span className="tabular-nums font-semibold text-[color:var(--color-text-primary)]">
              {column.index}
            </span>{" "}
            {column.label}
          </li>
        ))}
      </ol>
    </>
  );
}
