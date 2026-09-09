import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateTime } from "./format";

const AT = new Date("2026-09-08T16:30:45Z");

test("the month is spelled, so 8/9 can never be read as 9 August", () => {
  // "Sep" or "Sept" depending on the ICU build — either is unambiguous, a
  // bare number is not, and that is the whole point of the helper.
  assert.match(formatDate(AT), /^8 Sept? 2026$/, formatDate(AT));
});

test("a timestamp keeps the minute and drops the second", () => {
  const formatted = formatDateTime(AT);
  assert.match(formatted, /^8 Sept?, \d{2}:\d{2}$/, formatted);
});
