"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createCustomer, type ActionState } from "../actions";
import { ErrorNote, Field, buttonClass, inputClass } from "@/components/ui";

export function CustomerForm({
  sources,
}: {
  sources: { id: string; name: string; code: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createCustomer,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <ErrorNote>{state.error}</ErrorNote>}

      <Field label="Name (required)" hint={state.fieldErrors?.name}>
        <input name="name" className={inputClass} required maxLength={160} />
      </Field>

      <Field
        label="Phone (required)"
        hint={state.fieldErrors?.phoneE164 ?? "International format, e.g. +919876543210"}
      >
        <input
          name="phoneE164"
          className={inputClass}
          required
          inputMode="tel"
          placeholder="+919876543210"
        />
      </Field>

      <Field label="Email" hint={state.fieldErrors?.email}>
        <input name="email" type="email" className={inputClass} />
      </Field>

      <Field label="Location">
        <input name="location" className={inputClass} maxLength={160} />
      </Field>

      <Field label="Source (required)" hint={state.fieldErrors?.sourceId}>
        <select name="sourceId" className={inputClass} required defaultValue="">
          <option value="" disabled>
            Select a source
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Source detail" hint="Campaign name, referrer, agent — where applicable.">
        <input name="sourceDetail" className={inputClass} maxLength={240} />
      </Field>

      <Field label="Requirements">
        <textarea name="requirements" className={inputClass} rows={4} maxLength={4000} />
      </Field>

      <div className="flex gap-2">
        {/* §6: loading preserves dimensions and prevents duplicate submit. */}
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : "Create customer"}
        </button>
        <Link href="/customers" className={buttonClass.secondary}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
