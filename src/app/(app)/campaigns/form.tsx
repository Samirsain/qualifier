"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { saveCampaign, type CampaignState } from "./actions";
import { resolveAudience, type PreviewResult } from "./preview-action";
import {
  Card,
  ErrorNote,
  Field,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { INTEREST_STATUS_LABELS } from "@/lib/labels";

export type CampaignFormOptions = {
  sources: { id: string; name: string }[];
  templates: { id: string; name: string; category: string }[];
  tags: { name: string }[];
  stages: { code: string; name: string }[];
  staff: { id: string; displayName: string }[];
  earlierCampaigns: { id: string; name: string }[];
};

export type CampaignDraft = {
  id: string;
  name: string;
  purpose: string | null;
  templateId: string;
  scheduledAt: Date | null;
  segment: {
    sourceIds: string[];
    campaignIds: string[];
    tagNames: string[];
    tagMatch: "ANY" | "ALL";
    interestStatuses: string[];
    leadStageCodes: string[];
    assignedStaffIds: string[];
    onlyUnassigned: boolean;
    createdAfter: Date | null;
    createdBefore: Date | null;
  };
};

function forInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function forDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * UI-010 — Campaign Creation. Single page with sections and a sticky review:
 * name/purpose → segment builder → resolved audience preview → template →
 * schedule → save.
 */
export function CampaignForm({
  options,
  draft,
}: {
  options: CampaignFormOptions;
  draft?: CampaignDraft;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<CampaignState, FormData>(
    saveCampaign,
    {},
  );
  const [preview, previewAction, previewing] = useActionState<
    PreviewResult | null,
    FormData
  >(resolveAudience, null);

  const s = draft?.segment;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={draft?.id ?? ""} />

        {state.error && <ErrorNote>{state.error}</ErrorNote>}

        <Card title="Campaign">
          <div className="flex flex-col gap-4">
            <Field label="Name (required)" hint={state.fieldErrors?.name}>
              <input
                name="name"
                defaultValue={draft?.name}
                className={inputClass}
                required
                maxLength={160}
              />
            </Field>
            <Field label="Purpose">
              <textarea
                name="purpose"
                defaultValue={draft?.purpose ?? ""}
                className={inputClass}
                rows={2}
                maxLength={500}
              />
            </Field>
          </div>
        </Card>

        <Card title="Audience">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Sources" hint="Leave empty for every source.">
              <select
                name="sourceIds"
                multiple
                size={6}
                className={inputClass}
                defaultValue={s?.sourceIds ?? []}
              >
                {options.sources.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Interest status">
              <select
                name="interestStatuses"
                multiple
                size={6}
                className={inputClass}
                defaultValue={s?.interestStatuses ?? []}
              >
                {Object.entries(INTEREST_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Lead stage">
              <select
                name="leadStageCodes"
                multiple
                size={5}
                className={inputClass}
                defaultValue={s?.leadStageCodes ?? []}
              >
                {options.stages.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-col gap-2">
              <Field label="Tags">
                <select
                  name="tagNames"
                  multiple
                  size={4}
                  className={inputClass}
                  defaultValue={s?.tagNames ?? []}
                >
                  {options.tags.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tag match">
                <select
                  name="tagMatch"
                  className={inputClass}
                  defaultValue={s?.tagMatch ?? "ANY"}
                >
                  <option value="ANY">Any selected tag</option>
                  <option value="ALL">All selected tags</option>
                </select>
              </Field>
            </div>

            <Field label="Came from an earlier campaign">
              <select
                name="campaignIds"
                multiple
                size={4}
                className={inputClass}
                defaultValue={s?.campaignIds ?? []}
              >
                {options.earlierCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-col gap-2">
              <Field label="Owner">
                <select
                  name="assignedStaffIds"
                  multiple
                  size={4}
                  className={inputClass}
                  defaultValue={s?.assignedStaffIds ?? []}
                >
                  {options.staff.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="onlyUnassigned"
                  defaultChecked={s?.onlyUnassigned}
                />
                <span className="text-[length:var(--text-small)]">
                  Only unassigned customers
                </span>
              </label>
            </div>

            <Field label="Added on or after">
              <input
                type="date"
                name="createdAfter"
                defaultValue={forDateInput(s?.createdAfter)}
                className={inputClass}
              />
            </Field>
            <Field label="Added on or before">
              <input
                type="date"
                name="createdBefore"
                defaultValue={forDateInput(s?.createdBefore)}
                className={inputClass}
              />
            </Field>
          </div>

          <p className="mt-4 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            Customers who have opted out are always excluded and this cannot be
            switched off. Project or plot interest is not offered as a filter —
            that data model is a pending business decision (GAP-033).
          </p>
        </Card>

        <Card title="Message and schedule">
          <div className="flex flex-col gap-4">
            <Field
              label="Template (required)"
              hint={
                state.fieldErrors?.templateId ??
                "Business-initiated sends use an approved template."
              }
            >
              <select
                name="templateId"
                className={inputClass}
                required
                defaultValue={draft?.templateId ?? ""}
              >
                <option value="" disabled>
                  Select a template
                </option>
                {options.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.category} — {t.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Schedule"
              hint="Leave empty to keep it a Draft you start by hand."
            >
              <input
                type="datetime-local"
                name="scheduledAt"
                defaultValue={forInput(draft?.scheduledAt)}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <div className="flex gap-2">
          <button type="submit" className={buttonClass.primary} disabled={pending}>
            {pending ? "Saving…" : draft ? "Save changes" : "Save campaign"}
          </button>
          <button
            type="submit"
            formAction={previewAction}
            className={buttonClass.secondary}
            disabled={previewing}
          >
            {previewing ? "Resolving…" : "Preview audience"}
          </button>
          <Link href="/campaigns" className={buttonClass.secondary}>
            Cancel
          </Link>
        </div>

        {state.saved && (
          <p
            role="status"
            className="text-[color:var(--color-status-success)]"
          >
            Campaign saved.
          </p>
        )}
      </form>

      <div className="flex flex-col gap-4">
        <Card title="Resolved audience">
          {preview === null ? (
            <p className="text-[color:var(--color-text-secondary)]">
              Choose filters, then Preview audience to see exactly who this
              campaign would reach before anything is sent.
            </p>
          ) : preview.error ? (
            <ErrorNote>{preview.error}</ErrorNote>
          ) : (
            <>
              <p className="text-[length:var(--text-h1)] font-semibold tabular-nums">
                {preview.total}
              </p>
              <p className="text-[color:var(--color-text-secondary)]">
                customer{preview.total === 1 ? "" : "s"} match these filters.
              </p>
              {preview.excludedOptOut > 0 && (
                <p className="mt-2 text-[length:var(--text-small)] text-[color:var(--color-status-warning)]">
                  {preview.excludedOptOut} further match but were excluded
                  because they opted out.
                </p>
              )}
              {preview.sample.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-[length:var(--text-small)]">
                  {preview.sample.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="font-[family-name:var(--font-mono)] text-[color:var(--color-text-secondary)]">
                        {c.phoneE164}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                The audience is frozen when the campaign starts, so later
                customer changes never rewrite who it was sent to.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
