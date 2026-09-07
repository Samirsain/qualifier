"use client";

import { useActionState, useRef, useState } from "react";
import {
  createBatch,
  previewNumbers,
  type CreateState,
  type PreviewState,
} from "../actions";
import {
  Badge,
  Card,
  Cell,
  ErrorNote,
  Field,
  Row,
  Table,
  buttonClass,
  inputClass,
} from "@/components/ui";

type Funnel = { id: string; name: string; version: number };

export function UploadForm({ funnels }: { funnels: Funnel[] }) {
  const [numbers, setNumbers] = useState("");
  const [preview, checkNumbers, checking] = useActionState<PreviewState, FormData>(
    previewNumbers,
    {},
  );
  const [created, create, creating] = useActionState<CreateState, FormData>(
    createBatch,
    {},
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // The preview belongs to the text it was run on; editing invalidates it.
  const reviewed = preview.summary !== undefined && preview.text === numbers;
  const summary = reviewed ? preview.summary : undefined;

  async function readFile(file: File) {
    setNumbers(await file.text());
  }

  return (
    <div className="space-y-4">
      <form action={checkNumbers} className="space-y-4">
        <Card title="The numbers">
          <div className="space-y-3">
            <Field
              label="Paste numbers"
              hint="One per line. Either just the number, or name,number. A header row is ignored."
            >
              <textarea
                name="numbers"
                rows={10}
                value={numbers}
                onChange={(e) => setNumbers(e.target.value)}
                placeholder={"Priya,9876543210\n9876543211"}
                className={`${inputClass} font-[family-name:var(--font-mono)]`}
              />
            </Field>

            <Field label="…or load a CSV" hint="The file is read here and pasted above; nothing is uploaded until you start the batch.">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
                className={inputClass}
              />
            </Field>

            {preview.error && <ErrorNote>{preview.error}</ErrorNote>}

            <button type="submit" className={buttonClass.secondary} disabled={checking}>
              {checking ? "Checking…" : "Check numbers"}
            </button>
          </div>
        </Card>
      </form>

      {summary && (
        <Card title="What was found">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="success">{summary.valid.length} ready to send</Badge>
            {summary.rejected.length > 0 && (
              <Badge tone="error">{summary.rejected.length} rejected</Badge>
            )}
            {summary.duplicateCount > 0 && (
              <Badge tone="info">{summary.duplicateCount} duplicates removed</Badge>
            )}
            {summary.assumedCountryCount > 0 && (
              <Badge tone="warning">
                {summary.assumedCountryCount} assumed +91
              </Badge>
            )}
          </div>

          {summary.assumedCountryCount > 0 && (
            <p className="mb-4 text-[color:var(--color-text-secondary)]">
              {summary.assumedCountryCount} number
              {summary.assumedCountryCount === 1 ? " was" : "s were"} written without a
              country code and read as Indian mobiles (+91). Check that is right before
              starting — this is the one step that can message the wrong person.
            </p>
          )}

          {summary.rejected.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 font-medium">Rejected rows</h3>
              <Table caption="Rejected rows" head={["Row", "What was there", "Why"]}>
                {summary.rejected.map((r) => (
                  <Row key={`${r.row}-${r.raw}`}>
                    <Cell className="tabular-nums">{r.row}</Cell>
                    <Cell className="font-[family-name:var(--font-mono)]">{r.raw}</Cell>
                    <Cell>{r.reason}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      <form action={create} className="space-y-4">
        <input type="hidden" name="numbers" value={numbers} />
        <Card title="Where they go">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Batch name">
              <input name="name" className={inputClass} required />
            </Field>
            <Field
              label="Funnel"
              hint="Only live funnels can run a batch. The version is frozen when the batch is created."
            >
              <select name="automationId" className={inputClass} required>
                <option value="">Select a funnel…</option>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (v{f.version})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {funnels.length === 0 && (
            <p className="mt-3" role="alert">
              No funnel is live yet. Activate one before uploading numbers.
            </p>
          )}

          {created.error && (
            <div className="mt-3">
              <ErrorNote>{created.error}</ErrorNote>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              className={buttonClass.primary}
              disabled={creating || !reviewed || funnels.length === 0}
              title={reviewed ? undefined : "Check the numbers first."}
            >
              {creating ? "Creating…" : "Create batch"}
            </button>
            {!reviewed && (
              <p className="text-[color:var(--color-text-secondary)]">
                Run “Check numbers” first, so nothing is sent to a list nobody has
                looked at.
              </p>
            )}
          </div>
        </Card>
      </form>
    </div>
  );
}
