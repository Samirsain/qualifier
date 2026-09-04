"use client";

import { useActionState } from "react";
import { activateAutomation, type ControlState } from "../actions";
import { buttonClass } from "@/components/ui";

/**
 * Activation is a high-impact control (doc 04 "confirmation state"), so it
 * confirms before it runs and reports the validation reason on refusal.
 */
export function ActivateButton({
  id,
  blocked,
}: {
  id: string;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<ControlState, FormData>(
    activateAutomation,
    {},
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className={buttonClass.primary}
        disabled={pending || blocked}
        title={
          blocked
            ? "Fix the validation problems below before activating."
            : undefined
        }
      >
        {pending ? "Activating…" : "Activate"}
      </button>
      {state.error && (
        <p
          role="alert"
          className="max-w-md text-right text-[length:var(--text-small)] text-[color:var(--color-status-error)]"
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-success)]"
        >
          {state.ok}
        </p>
      )}
    </form>
  );
}
