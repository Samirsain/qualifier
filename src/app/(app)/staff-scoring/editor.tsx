"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  activateScoreConfig,
  saveScoreConfig,
  type ConfigState,
} from "./actions";
import {
  Badge,
  ErrorNote,
  Field,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { ScoringConfig } from "@/lib/scoring/config";
import { FACTOR_LIST } from "@/lib/scoring/factors";

const NORMALISATIONS = [
  { value: "RAW", label: "Raw count" },
  { value: "PER_ASSIGNED", label: "Per assigned customer" },
  { value: "PER_TARGET", label: "Against a target" },
  { value: "CAPPED", label: "Capped count" },
];

/** UI-020 — the configuration editor. Saving never activates. */
export function ConfigEditor({
  config,
}: {
  config: { id: string; name: string; effectiveFrom: string; value: ScoringConfig } | null;
}) {
  const [state, action, pending] = useActionState<ConfigState, FormData>(
    saveScoreConfig,
    {},
  );
  const v = config?.value;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={config?.id ?? ""} />

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.saved && (
        <div
          role="status"
          className="rounded-[var(--radius-sm)] border border-[color:var(--color-status-success)] p-3"
        >
          <p className="text-[color:var(--color-status-success)]">
            Saved as an inactive configuration.
          </p>
          {state.problems && state.problems.length > 0 && (
            <>
              <p className="mt-2 font-medium">Before it can be activated:</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[length:var(--text-small)]">
                {state.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name (required)">
          <input
            name="name"
            defaultValue={config?.name}
            className={inputClass}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Effective from">
          <input
            type="date"
            name="effectiveFrom"
            defaultValue={config?.effectiveFrom}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border-default)]">
              {["Use", "Factor", "Direction", "Weight", "Normalisation", "Cap", "Target"].map(
                (h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-2 py-2 text-[length:var(--text-small)] font-medium text-[color:var(--color-text-secondary)]"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {FACTOR_LIST.map((f) => {
              const fc = v?.factors[f.key];
              return (
                <tr
                  key={f.key}
                  className="border-b border-[color:var(--color-border-default)] last:border-0"
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      name={`enabled.${f.key}`}
                      defaultChecked={fc?.enabled}
                      aria-label={`Use ${f.label}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{f.label}</span>
                    <p className="max-w-md text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                      {f.measure}
                    </p>
                    {f.pendingDecision && (
                      <p className="max-w-md text-[length:var(--text-small)] text-[color:var(--color-status-warning)]">
                        {f.pendingDecision}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={f.direction === "NEGATIVE" ? "error" : "success"}>
                      {f.direction === "NEGATIVE" ? "Subtracts" : "Adds"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.01"
                      name={`weight.${f.key}`}
                      defaultValue={fc?.weight ?? ""}
                      placeholder="unset"
                      className={inputClass}
                      aria-label={`Weight for ${f.label}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name={`normalisation.${f.key}`}
                      defaultValue={fc?.normalisation ?? "RAW"}
                      className={inputClass}
                      aria-label={`Normalisation for ${f.label}`}
                    >
                      {NORMALISATIONS.map((n) => (
                        <option key={n.value} value={n.value}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name={`cap.${f.key}`}
                      defaultValue={fc?.cap ?? ""}
                      className={inputClass}
                      aria-label={`Cap for ${f.label}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name={`target.${f.key}`}
                      defaultValue={fc?.target ?? ""}
                      className={inputClass}
                      aria-label={`Target for ${f.label}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allowNegativeTotal"
            defaultChecked={v?.allowNegativeTotal ?? true}
          />
          <span className="text-[length:var(--text-small)]">
            Score may go below zero
          </span>
        </label>
        <Field
          label="Minimum sample size"
          hint="Below this, a staff member is measured but not ranked."
        >
          <input
            type="number"
            min="0"
            name="minimumSampleSize"
            defaultValue={v?.minimumSampleSize ?? 0}
            className={inputClass}
          />
        </Field>
        <Field label="Score ceiling" hint="Leave empty for no upper bound.">
          <input
            type="number"
            min="0"
            name="scoreCeiling"
            defaultValue={v?.scoreCeiling ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="Approval note (required to activate)"
        hint="Who approved these weights, and on what basis. Doc 13 §10 — a score must be explainable later."
      >
        <textarea
          name="approvalNote"
          defaultValue={v?.approvalNote ?? ""}
          rows={3}
          className={inputClass}
          maxLength={2000}
        />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Save (inactive)"}
        </button>
        {config && (
          <Link href="/staff-scoring" className={buttonClass.secondary}>
            New configuration
          </Link>
        )}
      </div>
    </form>
  );
}

/** Activation is separate and refuses with reasons (doc 13 §4). */
export function ActivateConfig({ id, blocked }: { id: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<ConfigState, FormData>(
    activateScoreConfig,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className={buttonClass.primary}
        disabled={pending || blocked}
        title={blocked ? "Resolve the blockers before activating." : undefined}
      >
        {pending ? "Activating…" : "Activate"}
      </button>
      {state.error && (
        <p
          role="alert"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-error)]"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
