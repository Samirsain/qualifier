import assert from "node:assert/strict";
import test from "node:test";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-09-08T12:00:00Z");
const at = (ms: number) => relativeTime(new Date(NOW.getTime() + ms), NOW);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("the future reads forwards and the past backwards", () => {
  assert.equal(at(2 * DAY), "in 2 days");
  assert.equal(at(-3 * HOUR), "3 hours ago");
  assert.equal(at(-45 * MINUTE), "45 minutes ago");
});

test("a part-finished unit rounds down, so nothing reads early", () => {
  // 1 day 23 hours away is "in 1 day" — never "in 2 days".
  assert.equal(at(DAY + 23 * HOUR), "in 1 day");
  assert.equal(at(-(DAY + 23 * HOUR)), "1 day ago");
});

test("a day is counted, not named — 1d23h away is not tomorrow", () => {
  assert.equal(at(DAY), "in 1 day");
  assert.equal(at(-DAY), "1 day ago");
});

test("under a minute is just now, either side", () => {
  assert.equal(at(30_000), "just now");
  assert.equal(at(-30_000), "just now");
});
