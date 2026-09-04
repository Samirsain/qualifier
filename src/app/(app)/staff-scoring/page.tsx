import { deactivateScoreConfig } from "./actions";
import { ActivateConfig, ConfigEditor } from "./editor";
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  PageHeader,
  Row,
  Table,
  buttonClass,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { parseConfig, readyForActivation } from "@/lib/scoring/config";
import { calculateScore, rankable } from "@/lib/scoring/calculate";
import { activeScoreConfig, extractFactors, periodFor } from "@/lib/scoring/extract";
import { FACTOR_LIST, pendingFactors } from "@/lib/scoring/factors";

export const dynamic = "force-dynamic";

/**
 * UI-020 Staff Scoring + UI-021 Staff Comparison.
 *
 * The framework is complete: factors, versioned configuration, calculation and
 * comparison. **No configuration ships active.** Until management approves one,
 * this page shows the factor inputs and says plainly why there is no score,
 * rather than displaying an unweighted number that would read as a ranking.
 */
export default async function StaffScoringPage({
  searchParams,
}: PageProps<"/staff-scoring">) {
  const user = await requirePermission("staff_score:read");
  const params = await searchParams;
  const editingId = typeof params.edit === "string" ? params.edit : null;

  const canConfigure = can(user.roles, "staff_score:configure");

  const [configs, active, staff, editing] = await Promise.all([
    prisma.staffScoreConfig.findMany({
      orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }],
      take: 25,
    }),
    activeScoreConfig(),
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        userRoles: { some: { role: { code: { in: ["STAFF", "MANAGER"] } } } },
      },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    editingId
      ? prisma.staffScoreConfig.findUnique({ where: { id: editingId } })
      : Promise.resolve(null),
  ]);

  const period = periodFor("MONTHLY");

  // Factor inputs are true regardless of weighting, so they are always shown.
  const rows = await Promise.all(
    staff.map(async (s) => {
      const { values, assignedCustomers } = await extractFactors(s.id, period);
      const result = active
        ? calculateScore(parseConfig(active.factorConfig), values, {
            assignedCustomers,
          })
        : null;
      return { staff: s, values, assignedCustomers, result };
    }),
  );

  const ranking = active
    ? rankable(
        rows
          .filter((r) => r.result !== null)
          .map((r) => ({ staffId: r.staff.id, result: r.result! })),
      )
    : null;

  return (
    <>
      <PageHeader
        title="Staff Scoring"
        description={`Configurable performance model. Period: ${period.start.toLocaleDateString()} — ${period.end.toLocaleDateString()}.`}
      />

      {!active && (
        <Card className="mb-4">
          <p className="font-medium">No scoring configuration is active.</p>
          <p className="mt-1 text-[color:var(--color-text-secondary)]">
            Doc 13 §4 requires that a production ranking formula is not shipped
            until management approves weights, normalisation, caps and
            attribution (GAP-001). The factor inputs below are the raw measures
            that formula will consume — they are real, auditable numbers. No
            score is calculated from them until a configuration is approved and
            activated.
          </p>
        </Card>
      )}

      <Card title="Measured factor inputs" className="mb-4">
        {rows.length === 0 ? (
          <EmptyState title="No staff to measure" />
        ) : (
          <Table
            caption="Factor inputs for the current period"
            head={[
              "Staff",
              "Assigned",
              ...FACTOR_LIST.map((f) => f.label),
              ...(active ? ["Score"] : []),
            ]}
          >
            {rows.map((r) => (
              <Row key={r.staff.id}>
                <Cell className="font-medium">{r.staff.displayName}</Cell>
                <Cell className="tabular-nums">{r.assignedCustomers}</Cell>
                {FACTOR_LIST.map((f) => (
                  <Cell
                    key={f.key}
                    className={
                      f.direction === "NEGATIVE" && r.values[f.key] > 0
                        ? "tabular-nums text-[color:var(--color-status-error)]"
                        : "tabular-nums"
                    }
                  >
                    {r.values[f.key]}
                  </Cell>
                ))}
                {active && (
                  <Cell className="tabular-nums font-medium">
                    {r.result?.ok ? (
                      <>
                        {r.result.score}
                        {r.result.belowSampleSize && (
                          <Badge tone="warning">below sample size</Badge>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </Cell>
                )}
              </Row>
            ))}
          </Table>
        )}

        <div className="mt-4 flex flex-col gap-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          <p className="font-medium">
            Factors whose measure still depends on an open decision:
          </p>
          {pendingFactors().map((f) => (
            <p key={f.key}>
              <strong>{f.label}</strong> — {f.pendingDecision}
            </p>
          ))}
        </div>
      </Card>

      {active && (
        <Card title="Comparison" className="mb-4">
          {ranking && "blocked" in ranking ? (
            <p className="text-[color:var(--color-text-secondary)]">
              Ranking withheld: {ranking.blocked}
            </p>
          ) : (
            <Table caption="Ranking" head={["#", "Staff", "Score"]}>
              {(ranking as { staffId: string; score: number }[]).map((r, i) => (
                <Row key={r.staffId}>
                  <Cell className="tabular-nums">{i + 1}</Cell>
                  <Cell>
                    {staff.find((s) => s.id === r.staffId)?.displayName ?? r.staffId}
                  </Cell>
                  <Cell className="tabular-nums font-medium">{r.score}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Card title="Scoring configurations" className="mb-4">
        {configs.length === 0 ? (
          <EmptyState
            title="No configurations yet"
            description={
              canConfigure
                ? "Build one below. It saves inactive — activating it is a separate, deliberate step."
                : "An administrator defines the scoring model."
            }
          />
        ) : (
          <Table
            caption="Scoring configurations"
            head={[
              "Name",
              "Effective from",
              "State",
              "Ready to activate",
              ...(canConfigure ? ["Actions"] : []),
            ]}
          >
            {configs.map((c) => {
              const problems = readyForActivation(parseConfig(c.factorConfig));
              return (
                <Row key={c.id}>
                  <Cell className="font-medium">{c.name}</Cell>
                  <Cell>{c.effectiveFrom.toLocaleDateString()}</Cell>
                  <Cell>
                    {c.active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge>Inactive</Badge>
                    )}
                  </Cell>
                  <Cell>
                    {problems.length === 0 ? (
                      <Badge tone="success">Ready</Badge>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-[color:var(--color-status-warning)]">
                          {problems.length} blocker
                          {problems.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[length:var(--text-small)]">
                          {problems.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Cell>
                  {canConfigure && (
                    <Cell>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/staff-scoring?edit=${c.id}`}
                          className={buttonClass.secondary}
                        >
                          Edit
                        </a>
                        {c.active ? (
                          <form action={deactivateScoreConfig}>
                            <input type="hidden" name="id" value={c.id} />
                            <button type="submit" className={buttonClass.secondary}>
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <ActivateConfig id={c.id} blocked={problems.length > 0} />
                        )}
                      </div>
                    </Cell>
                  )}
                </Row>
              );
            })}
          </Table>
        )}
      </Card>

      {canConfigure && (
        <Card title={editing ? `Edit "${editing.name}"` : "New scoring configuration"}>
          <ConfigEditor
            key={editing?.id ?? "new"}
            config={
              editing
                ? {
                    id: editing.id,
                    name: editing.name,
                    effectiveFrom: editing.effectiveFrom.toISOString().slice(0, 10),
                    value: parseConfig(editing.factorConfig),
                  }
                : null
            }
          />
        </Card>
      )}
    </>
  );
}
