/**
 * Dates the same way on every machine.
 *
 * `toLocaleString()` follows the server's locale, so the same row read
 * "8/9/2026" to one person and "9/8/2026" to another — a real ambiguity when
 * a column is full of send times. The month is spelled, and seconds are
 * dropped: nobody schedules a WhatsApp message to the second.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(date: Date): string {
  return DATE.format(date);
}

export function formatDateTime(date: Date): string {
  return DATE_TIME.format(date);
}
