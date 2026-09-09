"use client";

import { useActionState, useState } from "react";
import { saveFunnel, activateFunnel, type FunnelState } from "../actions";
import { Card, ErrorNote, Field, buttonClass, inputClass } from "@/components/ui";
import type { BuilderStep } from "@/lib/funnels/steps";

type Template = { id: string; name: string };

/** Stable and unique without a round trip; the engine only needs it to differ. */
function newKey() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const KIND_LABELS: Record<BuilderStep["kind"], string> = {
  message: "Message",
  question: "Question",
  wait: "Wait",
  qualify: "Mark qualified",
  stop: "Stop",
};

function Problems({ state }: { state: FunnelState }) {
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  if (!state.problems?.length) return null;
  return (
    <div role="alert" className="space-y-1">
      <ErrorNote>The funnel is not ready yet:</ErrorNote>
      <ul className="list-disc pl-6 text-[color:var(--color-status-error)]">
        {state.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export function Builder({
  id,
  name: initialName,
  steps: initialSteps,
  templates,
  status,
}: {
  id: string;
  name: string;
  steps: BuilderStep[];
  templates: Template[];
  status: string;
}) {
  const [name, setName] = useState(initialName);
  const [steps, setSteps] = useState<BuilderStep[]>(initialSteps);
  const [saveState, save, saving] = useActionState<FunnelState, FormData>(saveFunnel, {});
  const [activateState, activate, activating] = useActionState<FunnelState, FormData>(
    activateFunnel,
    {},
  );

  const update = (i: number, next: BuilderStep) =>
    setSteps((s) => s.map((step, j) => (i === j ? next : step)));

  const move = (i: number, delta: number) =>
    setSteps((s) => {
      const j = i + delta;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const remove = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));

  const add = (kind: BuilderStep["kind"]) =>
    setSteps((s) => {
      const key = newKey();
      switch (kind) {
        case "message":
          return [...s, { kind, key, templateId: templates[0]?.id ?? "" }];
        case "wait":
          return [...s, { kind, key, days: 1, hours: 0 }];
        case "qualify":
          return [...s, { kind, key }];
        case "stop":
          return [...s, { kind, key, reason: "", status: null }];
        case "question":
          return [
            ...s,
            {
              kind,
              key,
              templateId: templates[0]?.id ?? "",
              prompt: "",
              questionKey: "",
              yesKey: null,
              noKey: null,
              otherKey: null,
              noReplyDays: 0,
              noReplyKey: null,
            },
          ];
      }
    });

  return (
    <div className="space-y-4">
      <form action={save} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="steps" value={JSON.stringify(steps)} />

        <Card>
          <Field label="Funnel name">
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </Card>

        {steps.length === 0 && (
          <Card>
            <p className="text-[color:var(--color-text-secondary)]">
              No steps yet. Add a message, a question, and a Mark qualified step.
            </p>
          </Card>
        )}

        {steps.map((step, i) => (
          <Card
            key={step.key}
            title={`${i + 1}. ${KIND_LABELS[step.kind]}`}
            actions={
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className={buttonClass.secondary}
                  aria-label={`Move step ${i + 1} up`}
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === steps.length - 1}
                  className={buttonClass.secondary}
                  aria-label={`Move step ${i + 1} down`}
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className={buttonClass.danger}
                  aria-label={`Remove step ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              {step.kind === "message" && (
                <Field
                  label="Template"
                  hint="Business-initiated messages must use an approved template."
                >
                  <select
                    className={inputClass}
                    value={step.templateId}
                    onChange={(e) => update(i, { ...step, templateId: e.target.value })}
                  >
                    <option value="">Select a template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {step.kind === "wait" && (
                <>
                  <Field label="Days">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      className={inputClass}
                      value={step.days}
                      onChange={(e) =>
                        update(i, { ...step, days: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Hours">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      className={inputClass}
                      value={step.hours}
                      onChange={(e) =>
                        update(i, { ...step, hours: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                </>
              )}

              {step.kind === "stop" && (
                <>
                  <Field
                    label="Reason"
                    hint="Recorded against the run, so the stop is explainable later."
                  >
                    <input
                      className={inputClass}
                      value={step.reason}
                      onChange={(e) => update(i, { ...step, reason: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Leave the number as"
                    hint="This is what the batch counters and the number's status show afterwards."
                  >
                    <select
                      className={inputClass}
                      value={step.status ?? ""}
                      onChange={(e) =>
                        update(i, {
                          ...step,
                          status: (e.target.value || null) as typeof step.status,
                        })
                      }
                    >
                      <option value="">Leave it unchanged</option>
                      <option value="NOT_INTERESTED">Not interested</option>
                      <option value="NO_RESPONSE">No response</option>
                    </select>
                  </Field>
                </>
              )}

              {step.kind === "qualify" && (
                <p className="text-[color:var(--color-text-secondary)] md:col-span-2">
                  Marks the number as qualified and puts it on the Qualified list for
                  the CRM team.
                </p>
              )}

              {step.kind === "question" && (
                <>
                  <Field label="Template">
                    <select
                      className={inputClass}
                      value={step.templateId}
                      onChange={(e) => update(i, { ...step, templateId: e.target.value })}
                    >
                      <option value="">Select a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Answer key"
                    hint="Short name for the answer, e.g. wants_call."
                  >
                    <input
                      className={inputClass}
                      value={step.questionKey}
                      onChange={(e) => update(i, { ...step, questionKey: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Question text"
                    hint="What the customer is asked, in the words the template sends."
                  >
                    <input
                      className={inputClass}
                      value={step.prompt}
                      onChange={(e) => update(i, { ...step, prompt: e.target.value })}
                    />
                  </Field>
                  {(
                    [
                      ["yesKey", "If they say YES"],
                      ["noKey", "If they say NO"],
                      ["otherKey", "If the reply is unrecognised"],
                    ] as const
                  ).map(([field, label]) => (
                    <Field key={field} label={label}>
                      <select
                        className={inputClass}
                        value={step[field] ?? ""}
                        onChange={(e) =>
                          update(i, { ...step, [field]: e.target.value || null })
                        }
                      >
                        <option value="">End the funnel</option>
                        {steps.map((t, ti) =>
                          t.key === step.key ? null : (
                            <option key={t.key} value={t.key}>
                              {ti + 1}. {KIND_LABELS[t.kind]}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  ))}
                  <Field
                    label="If there is no reply for (days)"
                    hint="0 waits forever, which parks the number on this question with nothing to show for it."
                  >
                    <input
                      type="number"
                      min={0}
                      max={365}
                      className={inputClass}
                      value={step.noReplyDays}
                      onChange={(e) =>
                        update(i, { ...step, noReplyDays: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Then go to">
                    <select
                      className={inputClass}
                      value={step.noReplyKey ?? ""}
                      onChange={(e) =>
                        update(i, { ...step, noReplyKey: e.target.value || null })
                      }
                    >
                      <option value="">Nowhere — keep waiting</option>
                      {steps.map((t, ti) =>
                        t.key === step.key ? null : (
                          <option key={t.key} value={t.key}>
                            {ti + 1}. {KIND_LABELS[t.kind]}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                </>
              )}
            </div>
          </Card>
        ))}

        <Card title="Add a step">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(KIND_LABELS) as BuilderStep["kind"][]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => add(kind)}
                className={buttonClass.secondary}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </Card>

        <Problems state={saveState} />

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass.primary} disabled={saving}>
            {saving ? "Saving…" : "Save funnel"}
          </button>
          {saveState.saved && (
            <p role="status" className="text-[color:var(--color-status-success)]">
              Saved.
            </p>
          )}
          {status === "ACTIVE" && (
            <p className="text-[color:var(--color-text-secondary)]">
              This funnel is live — saving creates a new version, and runs already in
              flight keep the one they started on.
            </p>
          )}
        </div>
      </form>

      {status !== "ACTIVE" && (
        <form action={activate} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <Problems state={activateState} />
          <button type="submit" className={buttonClass.primary} disabled={activating}>
            {activating ? "Activating…" : "Activate funnel"}
          </button>
          {activateState.saved && (
            <p role="status" className="text-[color:var(--color-status-success)]">
              The funnel is live.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
