"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveFaq, type FaqState } from "./actions";
import { Field, buttonClass, inputClass } from "@/components/ui";

type Faq = {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
};

export function FaqEditor({ faq }: { faq: Faq | null }) {
  const [state, action, pending] = useActionState<FaqState, FormData>(saveFaq, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={faq?.id ?? ""} />

      {state.saved && (
        <p
          role="status"
          className="text-[length:var(--text-small)] text-[color:var(--color-status-success)]"
        >
          FAQ saved.
        </p>
      )}

      <Field label="Category (required)" hint={state.fieldErrors?.category}>
        <input
          name="category"
          defaultValue={faq?.category}
          className={inputClass}
          required
          maxLength={60}
        />
      </Field>

      <Field label="Question (required)" hint={state.fieldErrors?.question}>
        <textarea
          name="question"
          defaultValue={faq?.question}
          className={inputClass}
          rows={2}
          required
          maxLength={400}
        />
      </Field>

      <Field label="Answer (required)" hint={state.fieldErrors?.answer}>
        <textarea
          name="answer"
          defaultValue={faq?.answer}
          className={inputClass}
          rows={6}
          required
          maxLength={4000}
        />
      </Field>

      <Field label="Sort order" hint="Lower numbers appear first in the category.">
        <input
          name="sortOrder"
          type="number"
          min={0}
          max={9999}
          defaultValue={faq?.sortOrder ?? 0}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className={buttonClass.primary} disabled={pending}>
          {pending ? "Saving…" : faq ? "Save changes" : "Create FAQ"}
        </button>
        {faq && (
          <Link href="/faq" className={buttonClass.secondary}>
            New FAQ
          </Link>
        )}
      </div>
    </form>
  );
}
