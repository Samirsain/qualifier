"use client";

import { useActionState, useState } from "react";
import { sendReply, type ReplyState } from "./actions";
import { ErrorNote, buttonClass, inputClass } from "@/components/ui";

export function Composer({
  customerId,
  templates,
  disabled,
}: {
  customerId: string;
  templates: { id: string; name: string; category: string }[];
  disabled?: boolean;
}) {
  const [templateId, setTemplateId] = useState("");
  const [state, action, pending] = useActionState<ReplyState, FormData>(
    sendReply,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="customerId" value={customerId} />

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.sent && (
        <p
          role="status"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-success)]"
        >
          Message accepted by the provider.
        </p>
      )}

      {disabled && (
        <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          This conversation is closed. Reopen it to reply.
        </p>
      )}

      {templates.length > 0 && (
        <label>
          <span className="mb-1 block text-[length:var(--text-small)] font-medium">
            Approved template
          </span>
          <select
            name="templateId"
            className={inputClass}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={disabled}
          >
            <option value="">Free text reply</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.category} — {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <span className="mb-1 block text-[length:var(--text-small)] font-medium">
          Message
        </span>
        <textarea
          name="body"
          rows={3}
          className={inputClass}
          maxLength={4000}
          disabled={disabled || templateId !== ""}
          placeholder={
            templateId ? "The template body will be sent." : "Type a reply…"
          }
        />
      </label>

      <button
        type="submit"
        className={buttonClass.primary}
        disabled={disabled || pending}
      >
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
