import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberList } from "./parse-list";

test("bare numbers, one per line", () => {
  const s = parseNumberList("9876543210\n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.rejected.length, 0);
  assert.equal(s.assumedCountryCount, 2);
});

test("name and phone, comma separated", () => {
  const s = parseNumberList("Priya,9876543210\nRahul, 9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.valid[0].name, "Priya");
  assert.equal(s.valid[1].name, "Rahul");
  assert.equal(s.valid[1].e164, "+919876543211");
});

test("a header row is ignored", () => {
  const s = parseNumberList("name,phone\nPriya,9876543210");
  assert.equal(s.valid.length, 1);
  assert.equal(s.rejected.length, 0);
});

test("duplicates within the file are collapsed and counted", () => {
  const s = parseNumberList("9876543210\n9876543210\n98765 43210");
  assert.equal(s.valid.length, 1);
  assert.equal(s.duplicateCount, 2);
});

test("rejected rows carry their line number and reason", () => {
  const s = parseNumberList("9876543210\n1234567890\nabc");
  assert.equal(s.valid.length, 1);
  assert.equal(s.rejected.length, 2);
  assert.equal(s.rejected[0].row, 2);
  assert.ok(s.rejected[0].reason.length > 0);
  assert.equal(s.rejected[1].row, 3);
});

test("blank lines are skipped without being rejected", () => {
  const s = parseNumberList("9876543210\n\n   \n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.rejected.length, 0);
});

test("explicit country codes are not counted as assumed", () => {
  const s = parseNumberList("+919876543210\n9876543211");
  assert.equal(s.valid.length, 2);
  assert.equal(s.assumedCountryCount, 1);
});
