"use client";

import { useActionState } from "react";
import { createCall, createMeeting, type RequestState } from "./request-actions";
import { ErrorNote, Field, buttonClass, inputClass } from "@/components/ui";

type Option = { id: string; name: string; phoneE164?: string };

/** Staff-raised call or meeting requirement (F-015, F-016). */
export function RequestForm({
  kind,
  customers,
  staff,
}: {
  kind: "call" | "meeting";
  customers: { id: string; name: string; phoneE164: string }[];
  staff: { id: string; displayName: string }[];
}) {
  const [state, action, pending] = useActionState<RequestState, FormData>(
    kind === "call" ? createCall : createMeeting,
    {},
  );

  if (customers.length === 0) {
    return (
      <p className="text-[color:var(--color-text-secondary)]">
        Add a customer first — a request always belongs to one.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.saved && (
        <p
          role="status"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-success)]"
        >
          {kind === "call" ? "Call request created." : "Meeting request created."}
        </p>
      )}

      <Field label="Customer (required)" hint={state.fieldErrors?.customerId}>
        <select name="customerId" className={inputClass} required defaultValue="">
          <option value="" disabled>
            Select a customer
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.phoneE164}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Requirement (required)"
        hint={state.fieldErrors?.requirement ?? "What does the customer want?"}
      >
        <textarea
          name="requirement"
          rows={3}
          className={inputClass}
          required
          maxLength={500}
        />
      </Field>

      <Field
        label="Owner"
        hint="Leave blank to inherit the customer's current owner."
      >
        <select name="assignedStaffId" className={inputClass} defaultValue="">
          <option value="">Inherit from customer</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </Field>

      {kind === "meeting" && (
        <Field label="Scheduled for" hint={state.fieldErrors?.scheduledAt}>
          <input type="datetime-local" name="scheduledAt" className={inputClass} />
        </Field>
      )}

      <Field label="Notes">
        <textarea name="notes" rows={3} className={inputClass} maxLength={2000} />
      </Field>

      <button type="submit" className={buttonClass.primary} disabled={pending}>
        {pending
          ? "Saving…"
          : kind === "call"
            ? "Create call request"
            : "Create meeting request"}
      </button>
    </form>
  );
}

export type { Option };
