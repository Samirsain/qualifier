/**
 * "in 2 days" / "3 hours ago" — the form a person reads a tracking table in.
 *
 * The exact timestamp stays next to it on screen; this is the glanceable half.
 * `now` is a parameter so the result is testable rather than clock-dependent.
 */

// "always", not "auto": a run due in 1 day 23 hours must not read "tomorrow",
// which would name a day it will not fire on.
const RTF = new Intl.RelativeTimeFormat("en", { numeric: "always" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();

  for (const [unit, ms] of UNITS) {
    const value = diff / ms;
    // Round toward zero so "1.9 days" reads as 1 day, never as 2.
    if (Math.abs(value) >= 1) return RTF.format(Math.trunc(value), unit);
  }
  return "just now";
}
