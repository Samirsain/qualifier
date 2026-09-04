"use client";

import { useActionState } from "react";
import { createFollowUp, type FollowUpState } from "./actions";
import { ErrorNote, Field, buttonClass, inputClass } from "@/components/ui";

export function NewFollowUpForm({
  customers,
  staff,
}: {
  customers: { id: string; name: string; phoneE164: string }[];
  staff: { id: string; displayName: string }[];
}) {
  const [state, action, pending] = useActionState<FollowUpState, FormData>(
    createFollowUp,
    {},
  );

  if (customers.length === 0) {
    return (
      <p className="text-[color:var(--color-text-secondary)]">
        Add a customer first — a follow-up always belongs to one.
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
          Follow-up created.
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

      <Field label="Owner (required)" hint={state.fieldErrors?.assignedStaffId}>
        <select name="assignedStaffId" className={inputClass} required defaultValue="">
          <option value="" disabled>
            Select an owner
          </option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Type (required)" hint={state.fieldErrors?.type}>
        <input
          name="type"
          className={inputClass}
          required
          maxLength={60}
          placeholder="Call back, Send details, Site visit…"
          list="followup-types"
        />
        <datalist id="followup-types">
          <option value="Call back" />
          <option value="Send details" />
          <option value="Site visit" />
          <option value="Check interest" />
        </datalist>
      </Field>

      <Field label="Due (required)" hint={state.fieldErrors?.dueAt}>
        <input type="datetime-local" name="dueAt" className={inputClass} required />
      </Field>

      <Field label="Notes">
        <textarea name="notes" rows={3} className={inputClass} maxLength={2000} />
      </Field>

      <button type="submit" className={buttonClass.primary} disabled={pending}>
        {pending ? "Saving…" : "Create follow-up"}
      </button>
    </form>
  );
}
