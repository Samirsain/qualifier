/**
 * Template placeholders.
 *
 * Kept out of `outbound.ts` (which is server-only) so the substitution can be
 * tested on its own — it decides what a real person reads, so it is worth a
 * test that runs anywhere.
 */

export function fillPlaceholders(
  body: string,
  values: { name?: string | null },
): string {
  return body.replace(/\{\{\s*name\s*\}\}/g, values.name?.trim() || "there");
}

/** What is still unfilled, so a caller can refuse to send a half-written message. */
export function unfilledPlaceholders(body: string): string[] {
  return body.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [];
}
