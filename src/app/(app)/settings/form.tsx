"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsState } from "./actions";
import { Badge, ErrorNote, buttonClass, inputClass } from "@/components/ui";
import { SETTING_FIELDS } from "@/lib/setting-specs";

export function SettingsForm({ values }: { values: Record<string, string> }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveSettings,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.saved && (
        <p role="status" className="text-[color:var(--color-status-success)]">
          Saved. Every change is recorded in the activity log.
        </p>
      )}

      {SETTING_FIELDS.map((spec) => {
        const current = values[spec.key] ?? "";
        const isUnset = current === "";
        return (
          <div key={spec.key} className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {spec.label}
                <Badge tone={isUnset ? "warning" : "success"}>
                  {isUnset ? `${spec.gap} — unset` : spec.gap}
                </Badge>
                {spec.unit && (
                  <span className="text-[length:var(--text-small)] font-normal text-[color:var(--color-text-secondary)]">
                    in {spec.unit}
                  </span>
                )}
              </span>
              <input
                name={spec.key}
                defaultValue={current}
                className={inputClass}
                inputMode={spec.type === "number" ? "numeric" : undefined}
                placeholder={
                  spec.type === "list"
                    ? "comma, separated, values"
                    : spec.type === "timezone"
                      ? "Asia/Kolkata"
                      : "not decided yet"
                }
                aria-describedby={`${spec.key}-help`}
              />
            </label>
            <p
              id={`${spec.key}-help`}
              className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]"
            >
              {spec.help}
            </p>
            {isUnset && (
              <p className="text-[length:var(--text-small)] text-[color:var(--color-status-warning)]">
                While unset: {spec.whileUnset}
              </p>
            )}
            {state.fieldErrors?.[spec.key] && (
              <p
                role="alert"
                className="text-[length:var(--text-small)] text-[color:var(--color-status-error)]"
              >
                {state.fieldErrors[spec.key]}
              </p>
            )}
          </div>
        );
      })}

      <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
        Clearing a field un-makes the decision. The affected feature will refuse
        to run rather than fall back to a guessed value.
      </p>

      <div>
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Save configuration"}
        </button>
      </div>
    </form>
  );
}
