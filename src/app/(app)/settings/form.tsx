"use client";

import { useActionState } from "react";
import { saveOptOutWords, type SettingsState } from "./actions";
import { ErrorNote, buttonClass, inputClass } from "@/components/ui";

export function OptOutForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveOptOutWords,
    {},
  );

  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.saved && (
        <p role="status" className="text-[color:var(--color-status-success)]">
          Saved.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">Words that stop all messaging</span>
        <input
          name="keywords"
          defaultValue={value}
          className={inputClass}
          placeholder="STOP, UNSUBSCRIBE, BAND KARO"
          aria-describedby="optout-help"
        />
      </label>
      <p
        id="optout-help"
        className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]"
      >
        Comma separated, case does not matter. A number that replies with any of
        these is suppressed and never messaged again. Leave it empty and no word
        opts anyone out.
      </p>

      <div>
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
