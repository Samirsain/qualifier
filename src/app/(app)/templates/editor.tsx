"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveTemplate, type TemplateState } from "./actions";
import { Field, ErrorNote, buttonClass, inputClass } from "@/components/ui";

type Template = {
  id: string;
  name: string;
  category: string;
  body: string;
  providerTemplateKey: string | null;
  language: string | null;
  approvalStatus: string | null;
};

/** UI-016 — Template Editor with live preview (BR-22 "create, preview, edit"). */
export function TemplateEditor({ template }: { template: Template | null }) {
  const [body, setBody] = useState(template?.body ?? "");
  const [state, action, pending] = useActionState<TemplateState, FormData>(
    saveTemplate,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={template?.id ?? ""} />

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.saved && (
        <p
          role="status"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-success)]"
        >
          Template saved.
        </p>
      )}

      <Field label="Name (required)" hint={state.fieldErrors?.name}>
        <input
          name="name"
          defaultValue={template?.name}
          className={inputClass}
          required
          maxLength={120}
        />
      </Field>

      <Field label="Category (required)" hint={state.fieldErrors?.category}>
        <input
          name="category"
          defaultValue={template?.category}
          className={inputClass}
          required
          maxLength={60}
          placeholder="Introduction, FAQ, Follow-up…"
        />
      </Field>

      <Field
        label="Body (required)"
        hint={state.fieldErrors?.body ?? "Use {{name}} for personalisation."}
      >
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={inputClass}
          rows={6}
          required
          maxLength={4000}
        />
      </Field>

      <div>
        <span className="mb-1 block text-[length:var(--text-small)] font-medium">
          Preview
        </span>
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-muted)] p-3 whitespace-pre-wrap">
          {body.replace(/\{\{\s*name\s*\}\}/g, "Priya") || (
            <span className="text-[color:var(--color-text-secondary)]">
              Nothing to preview yet.
            </span>
          )}
        </div>
      </div>

      <Field
        label="Provider template key"
        hint="Required for business-initiated sends outside a session window."
      >
        <input
          name="providerTemplateKey"
          defaultValue={template?.providerTemplateKey ?? ""}
          className={inputClass}
          maxLength={120}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Language">
          <input
            name="language"
            defaultValue={template?.language ?? ""}
            className={inputClass}
            maxLength={12}
            placeholder="en"
          />
        </Field>
        <Field label="Approval status" hint="As reported by the provider.">
          <input
            name="approvalStatus"
            defaultValue={template?.approvalStatus ?? ""}
            className={inputClass}
            maxLength={40}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : template ? "Save changes" : "Create template"}
        </button>
        {template && (
          <Link href="/templates" className={buttonClass.secondary}>
            New template
          </Link>
        )}
      </div>
    </form>
  );
}
