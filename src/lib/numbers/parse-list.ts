import { parsePhone } from "@/lib/phone";

export type ValidRow = { row: number; name: string | null; e164: string; assumed: boolean };
export type RejectedRow = { row: number; raw: string; reason: string };

export type ParseSummary = {
  valid: ValidRow[];
  rejected: RejectedRow[];
  duplicateCount: number;
  assumedCountryCount: number;
};

const HEADER = /^(name|full ?name)?\s*,?\s*(phone|mobile|number|contact)/i;

export function parseNumberList(text: string): ParseSummary {
  const valid: ValidRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  const lines = (text ?? "").split(/\r?\n/);

  lines.forEach((line, i) => {
    const row = i + 1;
    const trimmed = line.trim();
    if (trimmed === "") return;
    if (row === 1 && HEADER.test(trimmed)) return;

    let name: string | null = null;
    let phoneRaw = trimmed;

    if (trimmed.includes(",")) {
      const parts = trimmed.split(",");
      // The phone is the last field; everything before it is the name.
      phoneRaw = parts[parts.length - 1].trim();
      const namePart = parts.slice(0, -1).join(",").trim();
      name = namePart === "" ? null : namePart;
    }

    const parsed = parsePhone(phoneRaw);
    if (!parsed.ok) {
      rejected.push({ row, raw: trimmed, reason: parsed.reason });
      return;
    }

    if (seen.has(parsed.e164)) {
      duplicateCount++;
      return;
    }
    seen.add(parsed.e164);

    valid.push({ row, name, e164: parsed.e164, assumed: parsed.assumedCountry });
  });

  return {
    valid,
    rejected,
    duplicateCount,
    assumedCountryCount: valid.filter((v) => v.assumed).length,
  };
}
